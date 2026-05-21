// 访问路径汇总: 本机 / Tailscale / cloudflared 公网
//
// 设计:
//   - Tailscale 是用户自己设备间(手机/iPad/其它 Mac)的低延迟内网通道,
//     不经过 cloudflare,延迟通常 <50ms,且不会有 quick-tunnel 530 的问题。
//   - cloudflared quick tunnel 是给"别人"或"自己不在 tailnet 的设备"用的公网兜底。
//   - 本机 127.0.0.1 是 Mac 本人浏览器最快。
//
// Tailscale 模式: 纯 opt-in
//   - 用户在 mcc.config.json 填 tailscaleHostname (e.g. "mac.tailxxx.ts.net") 才启用
//   - 没填则跳过, 不主动 spawn `tailscale` CLI 探测 (避免启动卡顿 / 依赖未启动的 daemon)

import { config } from "./config";
import * as Tunnel from "./tunnel";

export type AccessLink = {
    kind: "localhost" | "tailscale" | "tunnel";
    url: string;
    note?: string;
};

export type AccessInfo = {
    links: AccessLink[];           // 已按推荐顺序排列
    tailscaleHostname: string | null;
    tunnelUrl: string | null;
};

export const gather = async (): Promise<AccessInfo> => {
    const port = config.ports.caddy;
    const tailscaleHostname = config.tailscaleHostname?.trim() || null;
    const tunnel = Tunnel.status();
    const tunnelUrl = tunnel.active && tunnel.url ? tunnel.url : null;

    const links: AccessLink[] = [];
    if (tailscaleHostname) {
        links.push({
            kind: "tailscale",
            url: `http://${tailscaleHostname}:${port}/`,
            note: "推荐 · 内网低延迟",
        });
    }
    if (tunnelUrl) {
        links.push({
            kind: "tunnel",
            url: tunnelUrl,
            note: "公网 · 任何网络可达",
        });
    }
    links.push({
        kind: "localhost",
        url: `http://127.0.0.1:${port}/`,
        note: "仅本机",
    });

    return { links, tailscaleHostname, tunnelUrl };
};
