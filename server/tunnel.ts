// Cloudflare Quick Tunnel 管理 - 单例
//
// 启动: spawn `cloudflared tunnel --url http://localhost:<caddyPort>` 子进程,
//       从 stderr 行内 grep "https://*.trycloudflare.com" 拿 URL,最多等 20s。
// 停止: SIGTERM 进程,清空状态。
//
// 警告: 任何拿到 URL 的人能完全控制终端。MVP 不加鉴权,APK 端负责弹警告。

import { spawn, type Subprocess } from "bun";
import { config } from "./config";
import { publish } from "./ntfy";

// 用固定 title 让 APK 端用 filter 精确捞 host 通告,
// priority 1 = lowest, APK 自身 NtfyService 看到此标题就只更新 host 不弹通知
export const DISCOVERY_TITLE = "mcc-host";

export type TunnelState = {
    active: boolean;
    url: string | null;
    startedAt: number | null;
    pid: number | null;
};

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STARTUP_TIMEOUT_MS = 20_000;

let proc: Subprocess | null = null;
let url: string | null = null;
let startedAt: number | null = null;

const clear = () => {
    proc = null;
    url = null;
    startedAt = null;
};

export const status = (): TunnelState => ({
    active: proc !== null && url !== null,
    url,
    startedAt,
    pid: proc?.pid ?? null,
});

export const stop = async (): Promise<TunnelState> => {
    if (proc) {
        try { proc.kill("SIGTERM"); } catch {/* */ }
        try { await proc.exited; } catch {/* */ }
    }
    clear();
    return status();
};

export const start = async (): Promise<TunnelState> => {
    if (proc) return status();

    const target = `http://localhost:${config.ports.caddy}`;
    proc = spawn(["cloudflared", "tunnel", "--url", target, "--no-autoupdate"], {
        stderr: "pipe",
        stdout: "pipe",
    });
    startedAt = Date.now();

    // 启动后清理: 进程意外死掉
    proc.exited.then(() => {
        if (proc) {
            console.log(`[tunnel] cloudflared exited (was pid ${proc.pid})`);
        }
        clear();
    });

    // 并行扫 stderr / stdout 找 URL
    const found = waitForUrl(proc);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), STARTUP_TIMEOUT_MS));
    const winner = await Promise.race([found, timeout]);

    if (!winner) {
        await stop();
        throw new Error("cloudflared 未在 20s 内打印出 URL");
    }
    url = winner;
    console.log(`[tunnel] ✅ ${url}`);

    // 通告地址给 APK (无密码场景下 APK 唯一发现 Mac 的方式)
    announce(url).catch((e) => console.error("[tunnel] announce failed:", e));

    return status();
};

const announce = async (currentUrl: string): Promise<void> => {
    await publish({
        title: DISCOVERY_TITLE,
        message: currentUrl,
        priority: 1, // 不弹通知
        tags: ["mcc-discovery"],
    });
    console.log(`[tunnel] announced via ntfy`);
};

// 重发当前 URL (供启动时 / 定期心跳调用)
export const reannounce = async (): Promise<void> => {
    if (url) await announce(url);
};

const waitForUrl = async (p: Subprocess): Promise<string | null> => {
    const sources: ReadableStream<Uint8Array>[] = [];
    if (p.stderr instanceof ReadableStream) sources.push(p.stderr);
    if (p.stdout instanceof ReadableStream) sources.push(p.stdout);
    const decoder = new TextDecoder();
    for (const stream of sources) {
        // 并行不便实现简洁,串行 race 即可:cloudflared 主要打到 stderr
        const reader = stream.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const m = TUNNEL_URL_RE.exec(text);
                if (m) {
                    // 让 reader 释放但不读完(避免阻塞 stderr 的后续输出占 buffer)
                    reader.releaseLock();
                    drainSilently(stream);
                    return m[0];
                }
            }
        } finally {
            try { reader.releaseLock(); } catch {/* */ }
        }
    }
    return null;
};

// 后台静默吃掉剩余输出,避免 cloudflared stdio 缓冲堆积
const drainSilently = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done } = await reader.read();
            if (done) break;
        }
    } catch {/* */ } finally {
        try { reader.releaseLock(); } catch {/* */ }
    }
};
