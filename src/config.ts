export type ChannelKey = "society" | "campus";

export interface CareerChannel {
  key: ChannelKey;
  displayName: string;
  websitePath: string;
  portalType: number;
  baseUrl: string;
  listPath: string;
  detailUrl: (id: string) => string;
}

export const BASE_URL = "https://jobs.bytedance.com";

export const CHANNELS: Record<ChannelKey, CareerChannel> = {
  society: {
    key: "society",
    displayName: "字节跳动社会招聘",
    websitePath: "society",
    portalType: 2,
    baseUrl: BASE_URL,
    listPath: "/experienced/position",
    detailUrl: (id: string) => `${BASE_URL}/experienced/position/${encodeURIComponent(id)}/detail`
  },
  campus: {
    key: "campus",
    displayName: "字节跳动校园招聘",
    websitePath: "campus",
    portalType: 3,
    baseUrl: BASE_URL,
    listPath: "/campus/position",
    detailUrl: (id: string) => `${BASE_URL}/campus/position/${encodeURIComponent(id)}/detail`
  }
};

export function resolveChannel(channel?: ChannelKey): CareerChannel {
  return CHANNELS[channel ?? "society"];
}
