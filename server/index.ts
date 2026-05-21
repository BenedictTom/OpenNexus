// Bun 状态服务主入口
//
// 路由:
//   GET    /api/sessions                       会话列表
//   POST   /api/sessions                       创建 { path, label? }
//   GET    /api/sessions/:name                 单会话元数据
//   DELETE /api/sessions/:name                 删除
//   GET    /api/sessions/:name/messages        历史消息 (从 Claude jsonl 读)
//   POST   /api/sessions/:name/chat            发消息,返回 SSE 流 (Claude stream-json 转发)
//   GET    /api/sessions/:name/share           当前会话分享状态 (ttyd+cloudflared)
//   POST   /api/sessions/:name/share           启动: 临时 ttyd + tmux + claude --resume + cloudflared
//   DELETE /api/sessions/:name/share           停止: 杀 ttyd + cloudflared + tmux session
//
//   GET    /api/permissions                    pending 审批列表
//   POST   /api/permission                     hook 上报: 创建审批请求
//   POST   /api/permission/:id/decision        APK 回填决策 { choice, reason? }
//   GET    /api/permission/:id                 查询单条
//
//   GET    /api/tunnel                         分享 URL 状态
//   POST   /api/tunnel                         起 cloudflared
//   DELETE /api/tunnel                         关 cloudflared
//
//   POST   /api/event                          Notification/Stop 通用事件入口
//   GET    /api/events                         全局 SSE (会话/审批/tunnel 状态变化)
//
//   GET    /files/:session/<path>              文件浏览(dir 返 entries / file 返 meta+text content)
//   GET    /files/:session/<path>?raw=1         二进制原样(图片预览/下载)
//   GET    /api/access                          本机/Tailscale/cloudflared 三类访问路径汇总
//   GET    /api/fs/list?path=/Users/xx          目录浏览(新建会话选择文件夹用)
//   GET    /api/health                         健康检查

import { config } from "./config";
import * as Sessions from "./sessions";
import * as Chat from "./chat";
import * as Permissions from "./permissions";
import * as Files from "./files";
import * as Tunnel from "./tunnel";
import * as Share from "./share";
import * as Access from "./access";
import * as FS from "./fs";
import { sseResponse, broadcast } from "./events";
import { publish } from "./ntfy";

const json = (data: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(data), {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });

const error = (code: string, status = 400) => json({ error: code }, { status });

const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args);

const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    // 简单 CORS (Tailnet 内自用,放开)
    if (method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    log(method, pathname);

    // ── 健康检查 ─────────────────────────────────
    if (pathname === "/api/health") return json({ ok: true, ts: Date.now() });

    // ── SSE ─────────────────────────────────────
    if (pathname === "/api/events" && method === "GET") return sseResponse();

    // ── 会话 ────────────────────────────────────
    if (pathname === "/api/sessions" && method === "GET") {
        return json(Sessions.list());
    }
    if (pathname === "/api/sessions" && method === "POST") {
        const body = await req.json().catch(() => null) as { path?: string; label?: string } | null;
        if (!body?.path) return error("BAD_REQUEST");
        const r = Sessions.create(body.path, body.label);
        if ("error" in r) return error(r.error, 400);
        broadcast({ type: "session_created", session: r });
        return json(r);
    }
    {
        const m = pathname.match(/^\/api\/sessions\/([\w.-]+)$/);
        if (m && method === "GET") {
            const meta = Sessions.get(m[1]);
            if (!meta) return error("SESSION_NOT_FOUND", 404);
            return json(meta);
        }
        if (m && method === "DELETE") {
            const name = m[1];
            const ok = Sessions.remove(name);
            if (!ok) return error("SESSION_NOT_FOUND", 404);
            broadcast({ type: "session_deleted", name });
            return json({ name, deleted: true });
        }
    }

    // ── 聊天: 历史 + 发送 (SSE 流式) ─────────────
    {
        const m = pathname.match(/^\/api\/sessions\/([\w.-]+)\/messages$/);
        if (m && method === "GET") {
            const meta = Sessions.get(m[1]);
            if (!meta) return error("SESSION_NOT_FOUND", 404);
            return json({
                session: { ...meta, status: "idle" as const },
                messages: Chat.readHistory(m[1]),
            });
        }
    }
    {
        const m = pathname.match(/^\/api\/sessions\/([\w.-]+)\/chat$/);
        if (m && method === "POST") {
            const name = m[1];
            const meta = Sessions.get(name);
            if (!meta) return error("SESSION_NOT_FOUND", 404);
            const body = await req.json().catch(() => null) as { message?: string } | null;
            const message = body?.message?.trim();
            if (!message) return error("EMPTY_MESSAGE");

            const encoder = new TextEncoder();
            const ac = new AbortController();
            const stream = new ReadableStream({
                start(controller) {
                    const enqueue = (event: string, data: unknown) => {
                        try {
                            controller.enqueue(
                                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                            );
                        } catch { /* closed */ }
                    };
                    // 心跳避免代理切断
                    const hb = setInterval(() => {
                        try { controller.enqueue(encoder.encode(`: hb\n\n`)); } catch { /* */ }
                    }, 15000);

                    Chat.sendMessage({
                        sessionName: name,
                        userMessage: message,
                        signal: ac.signal,
                        onEvent: (e) => {
                            enqueue(e.type, e);
                            if (e.type === "done") {
                                clearInterval(hb);
                                try { controller.close(); } catch { /* */ }
                                broadcast({ type: "session_updated", name });
                            }
                        },
                    });
                },
                cancel() {
                    ac.abort();
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            });
        }
    }

    // ── 按会话分享 (ttyd + cloudflared) ──────────
    {
        const m = pathname.match(/^\/api\/sessions\/([\w.-]+)\/share$/);
        if (m) {
            const name = m[1];
            if (!Sessions.get(name)) return error("SESSION_NOT_FOUND", 404);
            if (method === "GET") {
                return json(Share.status(name));
            }
            if (method === "POST") {
                try {
                    const s = await Share.start(name);
                    broadcast({ type: "share_started", sessionName: name, share: s });
                    return json(s);
                } catch (e) {
                    return json({ error: String((e as Error).message ?? e) }, { status: 500 });
                }
            }
            if (method === "DELETE") {
                const s = await Share.stop(name);
                broadcast({ type: "share_stopped", sessionName: name });
                return json(s);
            }
        }
    }

    // ── 审批 ────────────────────────────────────
    if (pathname === "/api/permissions" && method === "GET") {
        return json(Permissions.listPending());
    }
    if (pathname === "/api/permission" && method === "POST") {
        const body = await req.json().catch(() => null) as any;
        if (!body?.id || !body?.toolName || !body?.cwd) return error("BAD_REQUEST");
        const r = await Permissions.createRequest(body);
        return json(r);
    }
    {
        const m = pathname.match(/^\/api\/permission\/([\w-]+)\/decision$/);
        if (m && method === "POST") {
            const body = await req.json().catch(() => null) as any;
            if (!body?.choice) return error("BAD_REQUEST");
            const r = Permissions.resolveRequest(m[1], body.choice, body.reason);
            if (!r) return error("REQUEST_NOT_FOUND", 404);
            return json(r);
        }
    }
    {
        const m = pathname.match(/^\/api\/permission\/([\w-]+)$/);
        if (m && method === "GET") {
            const r = Permissions.getRequest(m[1]);
            if (!r) return error("REQUEST_NOT_FOUND", 404);
            return json(r);
        }
    }

    // ── Cloudflare 临时公网分享 ─────────────────
    if (pathname === "/api/tunnel" && method === "GET") {
        return json(Tunnel.status());
    }
    if (pathname === "/api/tunnel" && method === "POST") {
        try {
            const r = await Tunnel.start();
            broadcast({ type: "tunnel_started", tunnel: r });
            return json(r);
        } catch (e) {
            return json({ error: String((e as Error).message ?? e) }, { status: 500 });
        }
    }
    if (pathname === "/api/tunnel" && method === "DELETE") {
        const r = await Tunnel.stop();
        broadcast({ type: "tunnel_stopped" });
        return json(r);
    }

    // ── 通用事件 (Notification/Stop hook 走这里) ──
    if (pathname === "/api/event" && method === "POST") {
        const body = await req.json().catch(() => null) as any;
        if (!body?.type) return error("BAD_REQUEST");
        log("event", body.type, body.session ?? "");
        broadcast({ type: "event", payload: body });
        // 非阻塞推送
        await publish({
            title: body.session ? `${body.session}: ${body.type}` : `Claude: ${body.type}`,
            message: body.message ?? body.type,
            priority: 3,
            click: body.session ? `mcc://session/${body.session}` : undefined,
        });
        return json({ ok: true });
    }

    // ── 文件浏览 / 预览 ─────────────────────────
    {
        const m = pathname.match(/^\/files\/([\w.-]+)(?:\/(.*))?$/);
        if (m && method === "GET") {
            const sessionName = m[1];
            const sub = m[2] ?? "";
            const raw = url.searchParams.get("raw") === "1";

            // ?raw=1 -> 二进制原样(图片预览/下载)
            if (raw) {
                const r = Files.readFileRaw(sessionName, sub);
                if (!r) return error("NOT_FOUND", 404);
                return new Response(r.buf, {
                    headers: {
                        "Content-Type": r.mime,
                        "Cache-Control": "public, max-age=60",
                    },
                });
            }

            const dir = Files.listDir(sessionName, sub);
            if (dir) return json({ type: "dir", entries: dir, path: sub });
            const file = Files.readFileMeta(sessionName, sub);
            if (file) return json(file);
            return error("NOT_FOUND", 404);
        }
    }

    // ── 访问路径汇总 (Tailscale / 公网 cloudflared / 本机) ──
    if (pathname === "/api/access" && method === "GET") {
        return json(await Access.gather());
    }

    // ── 文件系统目录浏览 (创建会话用) ──
    //   GET /api/fs/list?path=/Users/xxx  → { path, parent, entries:[{name,type}] }
    //   省略 path 时, 默认列 $HOME
    if (pathname === "/api/fs/list" && method === "GET") {
        const p = url.searchParams.get("path");
        const r = FS.listDir(p || undefined);
        if (!r) return error("INVALID_PATH", 400);
        return json(r);
    }

    return error("NOT_FOUND", 404);
};

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.ports.state,
    fetch: handler,
    error(err) {
        console.error("[server error]", err);
        return error("INTERNAL", 500);
    },
});

console.log(`✅ state svc listening on http://${server.hostname}:${server.port}`);
console.log(`   ntfy topic: ${config.ntfyTopic.slice(0, 8)}...${config.ntfyTopic.slice(-4)}`);

// 启动时打印可用访问路径(本机/Tailscale/cloudflared 起来后会再打一次)
Access.gather().then((a) => {
    console.log(`\n📡 访问路径:`);
    for (const link of a.links) {
        console.log(`   ${link.kind.padEnd(12)} ${link.url}${link.note ? " · " + link.note : ""}`);
    }
}).catch(() => {/* */ });

// 自动启动 cloudflared tunnel + 周期 re-announce
// 关闭方式: 设 MCC_AUTO_TUNNEL=false
if ((process.env.MCC_AUTO_TUNNEL ?? "true") !== "false") {
    Tunnel.start()
        .then((s) => console.log(`✅ auto tunnel: ${s.url}`))
        .catch((e) => console.error("❌ auto tunnel failed:", e.message));

    // 每 6 小时重发一次 host 通告,防止 APK 刚装时 ntfy 历史窗口外
    setInterval(() => {
        Tunnel.reannounce().catch((e) => console.error("re-announce failed:", e));
    }, 6 * 60 * 60 * 1000);
}

// ── 优雅关闭: 清掉所有按会话分享 + 主 tunnel ──
let shuttingDown = false;
const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] caught ${sig}, cleaning up shares and tunnel...`);
    try { await Share.stopAll(); } catch (e) { console.error("share cleanup:", e); }
    try { await Tunnel.stop(); } catch (e) { console.error("tunnel cleanup:", e); }
    console.log(`[shutdown] done, bye.`);
    process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
