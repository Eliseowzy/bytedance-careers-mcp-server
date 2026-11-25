import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJobFilters, getJobPostDetail, searchJobPosts } from "./api/bytedance/client.js";
import type { RawCategoryNode, RawCity, RawFiltersData, RawJobPost, RawSubject } from "./api/bytedance/types.js";
import { cached } from "./cache.js";
import { CHANNELS, resolveChannel, type CareerChannel } from "./config.js";
import type { Logger } from "./logger.js";

const DAY = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;

const response = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
});

const channelSchema = z
  .enum(["society", "campus"])
  .default("society")
  .describe("招聘频道：society（社会招聘，默认）或 campus（校园招聘）");

const stringOrArraySchema = z.union([z.string(), z.array(z.string())]).optional();

function toStringArray(value?: string | string[]): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((item) => item.trim()).filter(Boolean);
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function withoutNullish<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === null || item === undefined || item === "") return false;
      if (Array.isArray(item) && item.length === 0) return false;
      return true;
    })
  ) as Partial<T>;
}

function truncate(value?: string | null, max = 200): string | undefined {
  if (!value) return undefined;
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function subjectName(subject?: RawSubject | null): string | undefined {
  if (!subject?.name) return undefined;
  if (typeof subject.name === "string") return subject.name;
  return subject.name.zh_cn ?? subject.name.i18n ?? subject.name.en_us ?? undefined;
}

interface CleanCategory {
  id: string;
  name: string;
  enName?: string;
  children?: CleanCategory[];
}

interface FlatCategory {
  id: string;
  name: string;
  enName?: string;
  path: string;
  enPath?: string;
  parentId?: string;
}

interface CleanCity {
  code: string;
  name: string;
  enName?: string;
  pyName?: string;
}

interface CleanSubject {
  id: string;
  name: string;
  group?: string;
}

interface CleanFilters {
  categories: CleanCategory[];
  cities: CleanCity[];
  subjects: CleanSubject[];
}

function cleanCategoryNode(node: RawCategoryNode): CleanCategory {
  const children = (node.children ?? []).map(cleanCategoryNode);
  return withoutNullish({
    id: node.id,
    name: node.name ?? node.i18n_name ?? node.en_name ?? node.id,
    enName: node.en_name ?? undefined,
    children: children.length > 0 ? children : undefined
  }) as CleanCategory;
}

function cleanFilters(raw: RawFiltersData): CleanFilters {
  const categories = (raw.job_type_list ?? []).map(cleanCategoryNode);
  const cities: CleanCity[] = (raw.city_list ?? []).map((city: RawCity) =>
    withoutNullish({
      code: city.code,
      name: city.name ?? city.i18n_name ?? city.en_name ?? city.code,
      enName: city.en_name ?? undefined,
      pyName: city.py_name ?? undefined
    }) as CleanCity
  );
  const subjects: CleanSubject[] = (raw.job_subject_list ?? [])
    .map((subject: RawSubject) => {
      const name = subjectName(subject);
      if (!name) return null;
      return withoutNullish({
        id: subject.id,
        name,
        group: subject.subject_group_info?.name ?? subject.subject_group_info?.i18n_name ?? undefined
      }) as CleanSubject;
    })
    .filter((item): item is CleanSubject => item !== null);

  return { categories, cities, subjects };
}

function flattenCategories(
  nodes: CleanCategory[],
  parentPath = "",
  parentEnPath = "",
  parentId?: string
): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    const enPath = node.enName ? (parentEnPath ? `${parentEnPath}/${node.enName}` : node.enName) : undefined;
    result.push({ id: node.id, name: node.name, enName: node.enName, path, enPath, parentId });
    if (node.children) {
      result.push(...flattenCategories(node.children, path, enPath ?? "", node.id));
    }
  }
  return result;
}

function resolveCategoryIds(inputs: string[], tree: CleanCategory[]): string[] {
  if (inputs.length === 0) return [];
  const flat = flattenCategories(tree);
  return inputs.map((input) => {
    const exactId = flat.find((item) => item.id === input);
    if (exactId) return exactId.id;

    const normalizedPath = input.replace(/\s*[-/>]\s*/g, "/").toLowerCase();
    const pathMatches = flat.filter(
      (item) => item.path.toLowerCase() === normalizedPath || item.enPath?.toLowerCase() === normalizedPath
    );
    if (pathMatches.length === 1) return pathMatches[0].id;

    const lower = input.toLowerCase();
    const matches = flat.filter(
      (item) => item.name.toLowerCase() === lower || item.enName?.toLowerCase() === lower
    );
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      // If a parent and its direct child share the same name (e.g. 销售 and 销售/销售), prefer the parent.
      const topMatches = matches.filter((m) => !m.parentId);
      if (topMatches.length === 1 && matches.every((m) => m.id === topMatches[0].id || m.parentId === topMatches[0].id)) {
        return topMatches[0].id;
      }
      throw new Error(
        `职位类别“${input}”存在歧义，请改传完整路径或 id。候选: ${matches.map((m) => `${m.path}(${m.id})`).join(", ")}`
      );
    }
    throw new Error(`未找到职位类别“${input}”，请先调用 get_job_filters 查看可用类别。`);
  });
}

function matchCities(query: string, cities: CleanCity[]): CleanCity[] {
  const lower = query.toLowerCase();
  return cities.filter(
    (item) =>
      item.name.toLowerCase() === lower ||
      item.enName?.toLowerCase() === lower ||
      item.pyName?.toLowerCase() === lower
  );
}

function resolveCityCodes(inputs: string[], cities: CleanCity[]): string[] {
  if (inputs.length === 0) return [];
  return inputs.map((input) => {
    const exactCode = cities.find((item) => item.code === input);
    if (exactCode) return exactCode.code;

    let matches = matchCities(input, cities);
    if (matches.length === 0 && input.endsWith("市") && input.length > 2) {
      matches = matchCities(input.slice(0, -1), cities);
    }

    if (matches.length === 1) return matches[0].code;
    if (matches.length > 1) {
      throw new Error(
        `城市“${input}”存在歧义，请改传 code。候选: ${matches.map((m) => `${m.name}(${m.code})`).join(", ")}`
      );
    }
    throw new Error(`未找到城市“${input}”，请先调用 get_job_filters 查看可用城市。`);
  });
}

function resolveSubjectIds(inputs: string[], subjects: CleanSubject[]): string[] {
  if (inputs.length === 0) return [];
  return inputs.map((input) => {
    const exactId = subjects.find((item) => item.id === input);
    if (exactId) return exactId.id;

    const lower = input.toLowerCase();
    const matches = subjects.filter((item) => item.name.toLowerCase() === lower);
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      throw new Error(
        `招聘项目“${input}”存在歧义，请改传 id。候选: ${matches.map((m) => `${m.name}(${m.id})`).join(", ")}`
      );
    }
    if (/^\d+$/.test(input)) return input;
    throw new Error(`未找到招聘项目“${input}”，请先调用 get_job_filters 查看可用项目。`);
  });
}

function extractCities(job: RawJobPost): string[] {
  const names = (job.city_list ?? [])
    .map((c) => c.name ?? c.i18n_name ?? c.en_name)
    .filter((name): name is string => Boolean(name));
  if (names.length > 0) return Array.from(new Set(names));
  const primary = job.city_info?.name ?? job.city_info?.i18n_name ?? job.city_info?.en_name;
  return primary ? [primary] : [];
}

function extractRecruitType(job: RawJobPost): string | undefined {
  const parts = [job.recruit_type?.parent?.name, job.recruit_type?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : undefined;
}

function inferChannelFromJob(job: RawJobPost, fallback: CareerChannel): CareerChannel {
  const parentId = job.recruit_type?.parent?.id ?? job.recruit_type?.id;
  const parentName = job.recruit_type?.parent?.name ?? job.recruit_type?.name;
  if (parentId === "2" || parentName === "校招") return CHANNELS.campus;
  if (parentId === "1" || parentName === "社招") return CHANNELS.society;
  return fallback;
}

function mapJobSummary(job: RawJobPost, channel: CareerChannel) {
  const cities = extractCities(job);
  const actualChannel = inferChannelFromJob(job, channel);
  return withoutNullish({
    id: job.id,
    code: job.code,
    title: job.title,
    subTitle: job.sub_title,
    city: cities.join(", "),
    cities,
    category: job.job_category?.parent?.name ?? job.job_category?.name,
    subCategory: job.job_category?.parent ? job.job_category?.name : undefined,
    recruitType: extractRecruitType(job),
    subject: subjectName(job.job_subject),
    publishTime: job.publish_time ? new Date(job.publish_time).toISOString() : undefined,
    url: actualChannel.detailUrl(job.id),
    description: truncate(job.description, 200),
    requirement: truncate(job.requirement, 200)
  });
}

function mapJobDetail(job: RawJobPost, channel: CareerChannel) {
  const cities = extractCities(job);
  const actualChannel = inferChannelFromJob(job, channel);
  const info = job.job_post_info;
  const salary =
    info?.min_salary || info?.max_salary
      ? `${info.min_salary ?? ""}-${info.max_salary ?? ""} ${info.currency ?? ""}`.trim()
      : undefined;
  const tags = (job.tag_list ?? [])
    .map((t) => t.name ?? t.en_name)
    .filter((name): name is string => Boolean(name));

  return withoutNullish({
    channel: actualChannel.key,
    displayName: actualChannel.displayName,
    id: job.id,
    code: job.code,
    title: job.title,
    subTitle: job.sub_title,
    city: cities.join(", "),
    cities,
    address: info?.address,
    category: job.job_category?.parent?.name ?? job.job_category?.name,
    subCategory: job.job_category?.parent ? job.job_category?.name : undefined,
    recruitType: extractRecruitType(job),
    subject: subjectName(job.job_subject),
    education: info?.education,
    experience: info?.experience,
    salary,
    headCount: info?.head_count,
    tags,
    publishTime: job.publish_time ? new Date(job.publish_time).toISOString() : undefined,
    url: actualChannel.detailUrl(job.id),
    description: job.description,
    requirement: job.requirement
  });
}

const SERVER_ICON_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTE3MCAxMDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDk2OC4yMTYzODFsMTk3Ljg3NTgxLTUwLjUxNzMzM1YxMDUuMjI4MTlMMCA1NC43MTA4NTd6IiBmaWxsPSIjMkQ1OUM2Ii8+PHBhdGggZD0iTTk2OC4yMTYzODEgMHYxMDE4LjczMzcxNEwxMTcwLjI4NTcxNCA5NjguMjE2MzgxVjU0LjcxMDg1N3oiIGZpbGw9IiM3NkUwRDYiLz48cGF0aCBkPSJNNjQ4LjI4OTUyNCAzNzguODhsMjAyLjA2OTMzMy01MC41MTczMzN2NTM0LjYyNTUyM2wtMjAyLjA2OTMzMy01MC41MTczMzN6IiBmaWxsPSIjMjZDREQ1Ii8+PHBhdGggZD0iTTMxNS43MzMzMzMgNDU4Ljg0OTUyNGwyMDIuMDY5MzM0IDUwLjUxNzMzM3Y0MzMuNTkwODU3TDMxNS43MzMzMzMgOTk3LjY2ODU3MXoiIGZpbGw9IiMzMThFREUiLz48L3N2Zz4=";

export function createMcpServer(logger: Logger): McpServer {
  const server = new McpServer({
    name: "bytedance-careers",
    title: "字节跳动招聘",
    version: "1.0.1",
    websiteUrl: "https://jobs.bytedance.com",
    icons: [
      {
        src: SERVER_ICON_DATA_URI,
        mimeType: "image/svg+xml",
        sizes: ["any"]
      }
    ]
  });

  const loadFilters = (channel: CareerChannel) =>
    cached(`filters:${channel.key}`, DAY, async () => cleanFilters(await getJobFilters(channel)), logger);

  server.registerTool(
    "get_job_filters",
    {
      description:
        "获取字节跳动招聘（jobs.bytedance.com）的职位类别树、工作城市列表及招聘项目字典。结果缓存 24 小时，建议在需要按分类/城市筛选前调用。",
      inputSchema: {
        channel: channelSchema
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ channel: channelKey }) => {
      const channel = resolveChannel(channelKey);
      logger.info({ tool: "get_job_filters", channel: channel.key }, "tool call");
      const filters = await loadFilters(channel);
      return response(
        withoutNullish({
          channel: channel.key,
          displayName: channel.displayName,
          categories: filters.categories,
          cities: filters.cities.map(({ code, name, enName }) => withoutNullish({ code, name, enName })),
          subjects: filters.subjects
        })
      );
    }
  );

  server.registerTool(
    "search_jobs",
    {
      description:
        "搜索字节跳动社招或校招岗位。支持关键词（岗位名、团队名如 Seed/豆包、职位编号如 A229261A）、职位类别、城市、招聘项目及分页。categories/cities/subjects 均支持直接传中文名、英文名或接口 ID/code。",
      inputSchema: {
        channel: channelSchema,
        keyword: z.string().optional().describe("搜索关键词，如 Seed、后端、Agent、A229261A"),
        categories: stringOrArraySchema.describe(
          "职位类别名称、路径或 ID（支持单个字符串或数组），如 '后端'、'研发/后端'、'6704215862557018372'"
        ),
        cities: stringOrArraySchema.describe("工作城市名称或 code（支持单个字符串或数组），如 '北京'、'杭州市'、'CT_11'"),
        subjects: stringOrArraySchema.describe("招聘项目名称或 ID（校招常用，支持单个字符串或数组）"),
        recruitmentIds: z.array(z.string()).optional().describe("招聘类型原始 ID 列表（可选）"),
        page: z.number().int().min(1).default(1).describe("页码，从 1 开始"),
        limit: z.number().int().min(1).max(20).default(10).describe("每页条数，1~20，默认 10")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (args) => {
      const channel = resolveChannel(args.channel);
      const keyword = args.keyword?.trim() || undefined;
      logger.info({ tool: "search_jobs", channel: channel.key, keyword, page: args.page }, "tool call");

      const categoryInputs = toStringArray(args.categories);
      const cityInputs = toStringArray(args.cities);
      const subjectInputs = toStringArray(args.subjects);

      let categoryIds: string[] = [];
      let cityCodes: string[] = [];
      let subjectIds: string[] = [];

      if (categoryInputs.length > 0 || cityInputs.length > 0 || subjectInputs.length > 0) {
        const filters = await loadFilters(channel);
        categoryIds = uniqueSorted(resolveCategoryIds(categoryInputs, filters.categories));
        cityCodes = uniqueSorted(resolveCityCodes(cityInputs, filters.cities));
        subjectIds = uniqueSorted(resolveSubjectIds(subjectInputs, filters.subjects));
      }

      const params = {
        keyword,
        categoryIds,
        cityCodes,
        subjectIds,
        recruitmentIds: uniqueSorted((args.recruitmentIds ?? []).map((s) => s.trim()).filter(Boolean)),
        page: args.page,
        limit: args.limit
      };

      const cacheKey = `search:${channel.key}:${JSON.stringify(params)}`;
      const result = await cached(cacheKey, TEN_MINUTES, () => searchJobPosts(channel, params), logger);
      const total = result.count ?? 0;
      const list = result.job_post_list ?? [];

      return response({
        channel: channel.key,
        displayName: channel.displayName,
        total,
        page: args.page,
        limit: args.limit,
        hasMore: args.page * args.limit < total,
        jobs: list.map((job) => mapJobSummary(job, channel))
      });
    }
  );

  server.registerTool(
    "get_job_detail",
    {
      description:
        "获取字节跳动单个岗位的完整职位描述、任职要求、办公地址和官方投递链接。岗位 ID 可从 search_jobs 结果获取。",
      inputSchema: {
        id: z
          .string()
          .regex(/^\d+$/, "岗位 ID 必须是纯数字字符串")
          .describe("岗位 ID（19 位纯数字字符串，来自 search_jobs 返回的 id 字段，请务必以字符串传递避免精度丢失）"),
        channel: channelSchema
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ id, channel: channelKey }) => {
      const channel = resolveChannel(channelKey);
      logger.info({ tool: "get_job_detail", channel: channel.key, id }, "tool call");
      const detail = await cached(
        `detail:${channel.key}:${id}`,
        TEN_MINUTES,
        () => getJobPostDetail(channel, id),
        logger
      );
      return response(mapJobDetail(detail, channel));
    }
  );

  return server;
}
