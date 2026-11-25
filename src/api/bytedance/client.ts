import { BASE_URL, type CareerChannel } from "../../config.js";
import { clearSession, getSession, parseJsonSafe, REQUEST_TIMEOUT_MS, USER_AGENT } from "./session.js";
import type {
  ApiEnvelope,
  RawFiltersData,
  RawJobDetailData,
  RawJobPost,
  RawSearchData,
  SearchJobParams
} from "./types.js";

function commonHeaders(channel: CareerChannel): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    origin: BASE_URL,
    referer: `${BASE_URL}${channel.listPath}`,
    "website-path": channel.websitePath,
    "portal-channel": "office",
    "portal-platform": "pc",
    "user-agent": USER_AGENT
  };
}

async function getJson<T>(channel: CareerChannel, path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: commonHeaders(channel),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`字节招聘 ${path} 请求失败: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const envelope = await parseJsonSafe<ApiEnvelope<T>>(response, `字节招聘 ${path}`);
  if (envelope.code !== 0) {
    throw new Error(`字节招聘 ${path} 业务错误: ${envelope.message ?? "未知错误"} (code=${envelope.code})`);
  }
  return envelope.data;
}

async function postJson<T>(channel: CareerChannel, path: string, body: object, retry = true): Promise<T> {
  const session = await getSession(channel);
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...commonHeaders(channel),
      "content-type": "application/json",
      "x-csrf-token": session.token,
      cookie: session.cookie
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if ((response.status === 401 || response.status === 403 || response.status === 405) && retry) {
    clearSession(channel);
    return postJson<T>(channel, path, body, false);
  }

  if (!response.ok) {
    throw new Error(`字节招聘 ${path} 请求失败: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const envelope = await parseJsonSafe<ApiEnvelope<T>>(response, `字节招聘 ${path}`);
  if (envelope.code !== 0) {
    if (retry) {
      clearSession(channel);
      return postJson<T>(channel, path, body, false);
    }
    throw new Error(`字节招聘 ${path} 业务错误: ${envelope.message ?? "未知错误"} (code=${envelope.code})`);
  }

  return envelope.data;
}

export function getJobFilters(channel: CareerChannel): Promise<RawFiltersData> {
  return getJson<RawFiltersData>(channel, `/api/v1/config/job/filters/${channel.portalType}`);
}

export function searchJobPosts(channel: CareerChannel, params: SearchJobParams): Promise<RawSearchData> {
  const offset = (params.page - 1) * params.limit;
  return postJson<RawSearchData>(channel, "/api/v1/search/job/posts", {
    keyword: params.keyword ?? "",
    limit: params.limit,
    offset,
    job_category_id_list: params.categoryIds ?? [],
    location_code_list: params.cityCodes ?? [],
    recruitment_id_list: params.recruitmentIds ?? [],
    subject_id_list: params.subjectIds ?? [],
    job_function_id_list: [],
    tag_id_list: [],
    storefront_id_list: [],
    portal_type: channel.portalType,
    portal_entrance: 1
  });
}

export async function getJobPostDetail(channel: CareerChannel, id: string): Promise<RawJobPost> {
  const data = await getJson<RawJobDetailData>(channel, `/api/v1/job/posts/${encodeURIComponent(id)}`);
  const detail = data?.job_post_detail;
  if (!detail || !detail.id || !detail.title) {
    throw new Error(`未找到字节招聘岗位 ${id}，岗位可能不存在或已下线`);
  }
  return detail;
}
