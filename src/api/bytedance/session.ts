import { BASE_URL, type CareerChannel } from "../../config.js";
import type { ApiEnvelope } from "./types.js";

export interface CsrfSession {
  token: string;
  cookie: string;
  expiresAt: number;
}

const sessions = new Map<string, CsrfSession>();
const pending = new Map<string, Promise<CsrfSession>>();
const SESSION_TTL = 30 * 60 * 1000;

export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 15_000);

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,]+=)/);
}

export async function parseJsonSafe<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    const snippet = text.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`${label} 返回了非 JSON 响应 (HTTP ${response.status}, content-type=${contentType})，可能触发风控或页面异常: ${snippet}`);
  }
}

async function fetchCsrfSession(channel: CareerChannel): Promise<CsrfSession> {
  const response = await fetch(`${BASE_URL}/api/v1/csrf/token`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/json",
      origin: BASE_URL,
      referer: `${BASE_URL}${channel.listPath}`,
      "website-path": channel.websitePath,
      "portal-channel": "office",
      "portal-platform": "pc",
      "user-agent": USER_AGENT
    },
    body: JSON.stringify({ portal_entrance: 1 }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`获取字节招聘 CSRF Token 失败: HTTP ${response.status}`);
  }

  const envelope = await parseJsonSafe<ApiEnvelope<{ token?: string }>>(response, "字节招聘 /api/v1/csrf/token");
  const token = envelope.data?.token;
  if (envelope.code !== 0 || !token) {
    throw new Error(`获取字节招聘 CSRF Token 业务错误: ${envelope.message ?? "未知错误"} (code=${envelope.code})`);
  }

  const rawCookies = response.headers.getSetCookie?.() ?? splitSetCookie(response.headers.get("set-cookie") ?? "");
  const cookies = rawCookies.map((item) => item.split(";", 1)[0]).filter(Boolean);
  const hasCsrfCookie = cookies.some((item) => item.startsWith("atsx-csrf-token="));
  if (!hasCsrfCookie) {
    cookies.push(`atsx-csrf-token=${encodeURIComponent(token)}`);
  }

  return {
    token,
    cookie: cookies.join("; "),
    expiresAt: Date.now() + SESSION_TTL
  };
}

export async function getSession(channel: CareerChannel): Promise<CsrfSession> {
  const current = sessions.get(channel.key);
  if (current && current.expiresAt > Date.now()) return current;

  let promise = pending.get(channel.key);
  if (!promise) {
    promise = fetchCsrfSession(channel)
      .then((session) => {
        sessions.set(channel.key, session);
        return session;
      })
      .finally(() => pending.delete(channel.key));
    pending.set(channel.key, promise);
  }
  return promise;
}

export function clearSession(channel: CareerChannel): void {
  sessions.delete(channel.key);
}
