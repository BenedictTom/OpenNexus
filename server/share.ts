// 按会话临时公网分享 - 终端形式
//
// 设计:
//   POST /api/sessions/:name/share
//     1. 选空闲端口 (7100-7400)
//     2. spawn 一个 ttyd, 绑该端口, 执行
//          bash -c 'cd <sessPath> && exec tmux new-session -A -s mccshare_<name> "<claude> --resume <sid>"'
//     3. spawn 一个独立 cloudflared --url http://localhost:<port>
//     4. 等 cloudflared stderr 里出 trycloudflare URL, 返回
//   GET    /api/sessions/:name/share    → 状态
//   DELETE /api/sessions/:name/share    → SIGTERM ttyd + cloudflared + kill-session tmux
//
// 每个会话独立一对 ttyd+cloudflared。任何拿到 URL 的人能完全操作那个 Claude 终端。

import { spawn, type Subprocess } from "bun";
import * as net from "node:net";
import * as Sessions from "./sessions";

const TRYCFD_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const CFD_STARTUP_TIMEOUT_MS = 25_000;
const TTYD_READY_TIMEOUT_MS = 5_000;

const CLAUDE_BIN = process.env.MCC_CLAUDE_BIN
    || "/Users/caohongwei/.nvm/versions/node/v20.11.1/bin/claude";

export type ShareState = {
    active: boolean;
    url: string | null;
    ttydPort: number | null;
    startedAt: number | null;
};

type Internal = {
    sessionName: string;
    ttydPort: number;
    tmuxName: string;
    ttyd: Subprocess;
    cfd: Subprocess;
    url: string;
    startedAt: number;
};

const shares = new Map<string, Internal>();

const INACTIVE: ShareState = { active: false, url: null, ttydPort: null, startedAt: null };

const toPublic = (s: Internal | undefined): ShareState =>
    s
        ? { active: true, url: s.url, ttydPort: s.ttydPort, startedAt: s.startedAt }
        : INACTIVE;

const safeTmuxName = (name: string): string =>
    "mccshare_" + name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);

const isFree = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
        const s = net.createServer();
        s.once("error", () => resolve(false));
        s.once("listening", () => s.close(() => resolve(true)));
        s.listen(port, "127.0.0.1");
    });

const pickPort = async (): Promise<number> => {
    for (let p = 7100; p < 7400; p++) {
        if (await isFree(p)) return p;
    }
    throw new Error("no free port in 7100-7400");
};

const waitForTtyd = async (port: number): Promise<boolean> => {
    const deadline = Date.now() + TTYD_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        try {
            const r = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
            // ttyd 根路径返回 200 HTML
            if (r.status === 200 || r.status === 301 || r.status === 302) return true;
        } catch {/* not ready yet */ }
    }
    return false;
};

// waitForCfdUrl: 等 cloudflared 打印 URL,找到后 resolve；
// 同时继续 drain stdio 不释放 lock,避免 stdio 缓冲堆积导致 cloudflared 被 OS pipe 阻塞
const waitForCfdUrl = (cfd: Subprocess): Promise<string | null> =>
    new Promise((resolve) => {
        let done = false;
        const finish = (val: string | null) => {
            if (done) return;
            done = true;
            resolve(val);
        };
        const timer = setTimeout(() => finish(null), CFD_STARTUP_TIMEOUT_MS);
        const decoder = new TextDecoder();

        const consume = async (stream: ReadableStream<Uint8Array> | null | undefined) => {
            if (!stream) return;
            const reader = stream.getReader();
            try {
                while (true) {
                    const { value, done: streamEnd } = await reader.read();
                    if (streamEnd) return;
                    const text = decoder.decode(value);
                    if (!done) {
                        const m = TRYCFD_RE.exec(text);
                        if (m) { clearTimeout(timer); finish(m[0]); }
                    }
                    // 继续读，丢弃，防止 pipe 缓冲堆积
                }
            } catch {/* */ } finally {
                try { reader.releaseLock(); } catch {/* */ }
            }
        };
        consume(cfd.stderr as ReadableStream<Uint8Array> | undefined);
        consume(cfd.stdout as ReadableStream<Uint8Array> | undefined);
    });

const killTmuxSession = (name: string): void => {
    try {
        spawn(["tmux", "kill-session", "-t", name]).exited.catch(() => {/* */ });
    } catch {/* */ }
};

export const status = (sessionName: string): ShareState =>
    toPublic(shares.get(sessionName));

export const stop = async (sessionName: string): Promise<ShareState> => {
    const s = shares.get(sessionName);
    if (!s) return INACTIVE;
    shares.delete(sessionName);

    try { s.cfd.kill("SIGTERM"); } catch {/* */ }
    try { s.ttyd.kill("SIGTERM"); } catch {/* */ }
    // 等最多 2s
    await Promise.race([
        Promise.allSettled([s.cfd.exited, s.ttyd.exited]),
        new Promise((r) => setTimeout(r, 2000)),
    ]);
    // 兜底 kill -9
    try { s.cfd.kill(9); } catch {/* */ }
    try { s.ttyd.kill(9); } catch {/* */ }
    killTmuxSession(s.tmuxName);
    return INACTIVE;
};

export const start = async (sessionName: string): Promise<ShareState> => {
    const existing = shares.get(sessionName);
    if (existing) return toPublic(existing);

    const meta = Sessions.get(sessionName);
    if (!meta) throw new Error("SESSION_NOT_FOUND");

    const port = await pickPort();
    const tmuxName = safeTmuxName(sessionName);

    // claude --resume <sid> 失败 (sid 为空 / 已过期) 时回退到普通 claude
    const claudeCmd = meta.claudeSessionId
        ? `'${CLAUDE_BIN}' --resume '${meta.claudeSessionId}' 2>/dev/null || '${CLAUDE_BIN}'`
        : `'${CLAUDE_BIN}'`;

    // tmux new-session -A 已有则 attach,没有则新建。这样多端浏览看同一个 Claude
    const shellCmd = `cd '${meta.path}' && exec tmux new-session -A -s '${tmuxName}' "${claudeCmd}"`;

    // ttyd 起来后 fork shell。-W 允许键入；-t 是 termjs option
    // stdio 设 "ignore" 让 OS 直接丢弃 ttyd 输出,不需要我们读,避免 pipe 缓冲阻塞
    const ttyd = spawn(
        [
            "ttyd",
            "-W",
            "-p", String(port),
            "-i", "127.0.0.1",
            "-t", "fontSize=14",
            "-t", `titleFixed=Claude · ${sessionName}`,
            "-t", "rendererType=canvas",
            "bash", "-c", shellCmd,
        ],
        { stderr: "ignore", stdout: "ignore" },
    );

    const ready = await waitForTtyd(port);
    if (!ready) {
        try { ttyd.kill("SIGTERM"); } catch {/* */ }
        throw new Error(`ttyd 未在 ${TTYD_READY_TIMEOUT_MS}ms 内启动 on :${port}`);
    }

    const cfd = spawn(
        [
            "cloudflared", "tunnel",
            "--url", `http://localhost:${port}`,
            "--no-autoupdate",
        ],
        { stderr: "pipe", stdout: "pipe" },
    );

    const url = await waitForCfdUrl(cfd);
    if (!url) {
        try { cfd.kill("SIGTERM"); } catch {/* */ }
        try { ttyd.kill("SIGTERM"); } catch {/* */ }
        killTmuxSession(tmuxName);
        throw new Error("cloudflared 未在 25s 内打印出 URL");
    }
    // waitForCfdUrl 内部持续 drain stdio,不需要额外处理

    const internal: Internal = {
        sessionName,
        ttydPort: port,
        tmuxName,
        ttyd,
        cfd,
        url,
        startedAt: Date.now(),
    };
    shares.set(sessionName, internal);

    // 进程意外退出自动清理
    const guard = (p: Subprocess, label: string) => {
        p.exited.then(() => {
            if (shares.get(sessionName) === internal) {
                console.log(`[share] ${label} for "${sessionName}" exited unexpectedly, cleaning up`);
                stop(sessionName).catch(() => {/* */ });
            }
        });
    };
    guard(ttyd, "ttyd");
    guard(cfd, "cloudflared");

    console.log(`[share] ✅ ${sessionName} → ${url} (ttyd :${port})`);
    return toPublic(internal);
};

// 进程退出时清理全部 share
export const stopAll = async (): Promise<void> => {
    const names = Array.from(shares.keys());
    await Promise.all(names.map((n) => stop(n)));
};
