# ByteDance Careers MCP Server

[![npm version](https://img.shields.io/npm/v/bytedance-careers-mcp.svg)](https://www.npmjs.com/package/bytedance-careers-mcp)
[![license](https://img.shields.io/npm/l/bytedance-careers-mcp.svg)](./LICENSE)

字节跳动招聘（[`jobs.bytedance.com`](https://jobs.bytedance.com)）的非官方 MCP（Model Context Protocol）服务端，让 AI 助手直接按自然语言检索、对比和筛选字节社招与校招岗位。

## 特性

- **双频道支持**：同时覆盖社会招聘（`society`）与校园招聘 / 实习（`campus`）。
- **大模型友好**：支持直接传中文名、英文名或路径（如 `后端`、`研发/后端`、`北京市`、`杭州`），内部自动映射接口 ID/code，并裁剪冗余字段节省上下文。
- **轻量稳定**：自动管理 CSRF 会话与失效重试，无需浏览器自动化；内置进程内缓存（字典 24h、查询/详情 10min）与并发请求去重。
- **多模式运行**：支持 `stdio`（`npx` 一键使用）、本地/远程 `Streamable HTTP`、Docker 与 Vercel 部署。

## 快速开始（stdio / npx）

需要 Node.js `>= 20`。

### 通用 MCP 客户端（Claude Desktop / Cursor / Windsurf / Antigravity 等）

```json
{
  "mcpServers": {
    "bytedance-careers": {
      "command": "npx",
      "args": ["-y", "bytedance-careers-mcp"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add bytedance-careers -- npx -y bytedance-careers-mcp
```

### Codex CLI

```bash
codex mcp add bytedance-careers -- npx -y bytedance-careers-mcp
```

## Tools

| Tool | 说明 | 主要参数 |
| :--- | :--- | :--- |
| `get_job_filters` | 获取职位类别树、工作城市列表及招聘项目字典 | `channel`（`society` / `campus`） |
| `search_jobs` | 按关键词、职位类别、城市、招聘项目及分页搜索岗位 | `channel`、`keyword`、`categories`、`cities`、`subjects`、`page`、`limit` |
| `get_job_detail` | 获取单个岗位的完整职责、要求、办公地址与官网直达链接 | `id`（19 位纯数字字符串）、`channel` |

## 本地开发与 HTTP 模式

```bash
npm install
npm run build
npm start
```

- 健康检查：`GET http://localhost:3000/health`
- MCP Streamable HTTP 端点：`http://localhost:3000/mcp`
- 本地 `stdio` 调试：将客户端 `command` 设为 `node`，`args` 设为 `["/path/to/bytedance-careers-mcp-server/dist/src/stdio.js"]`

### Docker

```bash
docker compose up -d --build
```

## 环境变量

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP 模式监听端口 |
| `LOG_LEVEL` | `info` | 日志级别（`debug` / `info` / `warn` / `error`） |
| `REQUEST_TIMEOUT_MS` | `15000` | 上游接口请求超时（毫秒） |

## 免责声明

本项目为社区开源项目，与字节跳动官方无任何隶属关系。仅提供公开招聘页面的只读检索能力，请遵守目标网站的服务条款与合理访问频率，投递简历等操作请前往官网页面完成。

## License

[MIT](./LICENSE)
