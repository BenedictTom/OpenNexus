// Claude Code 子进程调用 + jsonl 历史读取
//
// 设计:
//   - 主线不用 tmux: 每条用户消息 spawn 一个 `claude -p --output-format stream-json` 子进程
//   - 首次发消息时用我们生成的 UUID 作为 --session-id, 后续 --resume 续聊
//   - stream-json 输出按行解析,实时回调给 SSE 转发
//   - 历史从 Claude 官方 jsonl 读 (~/.claude/projects/<encoded>/<sid>.jsonl)
//
// stream-json 协议 (Claude Code 2.x):
//   {"type":"system","subtype":"init","session_id":"...","model":"...","tools":[...]}
//   {"type":"assistant","message":{role:"assistant",content:[{type:"text"|"tool_use",...}]}}
//   {"type":"user","message":{role:"user",content:[{type:"tool_result",...}]}}
//   {"type":"result","subtype":"success"|"error","session_id":"...","result":"...","is_error":false}

import { spawn, type ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import * as Sessions from "./sessions";

// ── Claude 项目路径 → jsonl 目录编码 ──────────────────
// /Users/caohongwei/Program/foo → -Users-caohongwei-Program-foo
export const encodeProjectPath = (absPath: string): string =>
    resolve(absPath).replace(/\//g, "-");

export const jsonlPath = (absPath: string, claudeSessionId: string): string =>
    join(homedir(), ".claude", "projects", encodeProjectPath(absPath), `${claudeSessionId}.jsonl`);

// ── 历史消息渲染模型 ─────────────────────────────────
// 给前端聊天 UI 用的轻量结构 (剥掉 Anthropic API 完整 schema)
export type ChatBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
    | { type: "thinking"; text: string };

export type ChatMessage = {
    role: "user" | "assistant";
    blocks: ChatBlock[];
    timestamp: number;
    uuid?: string;
};

// 解析 Anthropic content (string 或 block 数组)
const parseContent = (content: unknown): ChatBlock[] => {
    if (typeof content === "string") return [{ type: "text", text: content }];
    if (!Array.isArray(content)) return [];
    return content.flatMap((b: any): ChatBlock[] => {
        if (b?.type === "text" && typeof b.text === "string") {
            return [{ type: "text", text: b.text }];
        }
        if (b?.type === "tool_use") {
            return [{ type: "tool_use", id: b.id, name: b.name, input: b.input }];
        }
        if (b?.type === "tool_result") {
            const content = typeof b.content === "string"
                ? b.content
                : Array.isArray(b.content)
                    ? b.content.map((c: any) => c?.text ?? "").join("")
                    : "";
            return [{ type: "tool_result", toolUseId: b.tool_use_id, content, isError: b.is_error }];
        }
        if (b?.type === "thinking" && typeof b.thinking === "string") {
            return [{ type: "thinking", text: b.thinking }];
        }
        return [];
    });
};

export const readHistory = (sessionName: string): ChatMessage[] => {
    const meta = Sessions.get(sessionName);
    if (!meta || !meta.claudeSessionId) return [];
    const path = jsonlPath(meta.path, meta.claudeSessionId);
    if (!existsSync(path)) return [];

    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ChatMessage[] = [];

    for (const line of lines) {
        let row: any;
        try { row = JSON.parse(line); } catch { continue; }

        // 只关心真正的 user / assistant 对话行
        if (row.type !== "user" && row.type !== "assistant") continue;

        // 跳过 sidechain (子任务自调)
        if (row.isSidechain) continue;

        const msg = row.message;
        if (!msg) continue;

        const blocks = parseContent(msg.content);
        if (blocks.length === 0) continue;

        // 过滤掉只有 tool_result 的 user 消息 (这些是工具回执,不是真用户)
        // 但保留有 text 的 user 消息 (真用户输入)
        const isToolResultOnly =
            row.type === "user" &&
            blocks.every((b) => b.type === "tool_result");
        // 我们仍然渲染 tool_result —— 在聊天 UI 里跟前面的 tool_use 配对展示
        // 这里不过滤,前端折叠到对应的 tool_use 卡片里

        const ts = row.timestamp ? new Date(row.timestamp).getTime() : Date.now();
        out.push({
            role: row.type,
            blocks,
            timestamp: ts,
            uuid: row.uuid,
        });
    }

    return out;
};

// ── 调 Claude 子进程 ──────────────────────────────────
export type StreamEvent =
    | { type: "system_init"; sessionId: string; model: string }
    | { type: "assistant_block"; block: ChatBlock }
    | { type: "tool_result"; block: ChatBlock }
    | { type: "result"; success: boolean; finalText: string; sessionId: string; durationMs?: number; costUsd?: number; error?: string }
    | { type: "error"; message: string }
    | { type: "stderr"; line: string }
    | { type: "done" };

type RunOptions = {
    sessionName: string;
    userMessage: string;
    onEvent: (e: StreamEvent) => void;
    signal?: AbortSignal;
};

export const sendMessage = async (opts: RunOptions): Promise<void> => {
    const { sessionName, userMessage, onEvent, signal } = opts;
    const meta = Sessions.get(sessionName);
    if (!meta) {
        onEvent({ type: "error", message: "SESSION_NOT_FOUND" });
        onEvent({ type: "done" });
        return;
    }

    // 首次会话: 自己生成一个 UUID 当 sessionId, 这样我们立刻知道 jsonl 路径
    // 后续: --resume <existingSid>
    const isFirst = !meta.claudeSessionId;
    const sessionId = meta.claudeSessionId ?? randomUUID();

    const args = [
        "--print",
        "--output-format", "stream-json",
        "--input-format", "text",
        "--verbose",  // stream-json 必须搭配
        ...(isFirst ? ["--session-id", sessionId] : ["--resume", sessionId]),
        userMessage,
    ];

    Sessions.setBusy(sessionName, true);

    let child: ChildProcess;
    try {
        child = spawn("claude", args, {
            cwd: meta.path,
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });
    } catch (e) {
        Sessions.setBusy(sessionName, false);
        onEvent({ type: "error", message: `spawn 失败: ${(e as Error).message}` });
        onEvent({ type: "done" });
        return;
    }

    let aborted = false;
    if (signal) {
        signal.addEventListener("abort", () => {
            aborted = true;
            try { child.kill("SIGTERM"); } catch { /* ignore */ }
        });
    }

    let capturedSessionId = sessionId;
    let finalText = "";

    const rl = createInterface({ input: child.stdout! });

    rl.on("line", (line) => {
        if (!line.trim()) return;
        let row: any;
        try { row = JSON.parse(line); }
        catch {
            // 非 JSON 行,可能是 warning,记一下
            onEvent({ type: "stderr", line: `[non-json] ${line}` });
            return;
        }

        if (row.type === "system" && row.subtype === "init") {
            capturedSessionId = row.session_id ?? capturedSessionId;
            if (isFirst || meta.claudeSessionId !== capturedSessionId) {
                Sessions.updateSessionId(sessionName, capturedSessionId);
            }
            onEvent({
                type: "system_init",
                sessionId: capturedSessionId,
                model: row.model ?? "",
            });
            return;
        }

        if (row.type === "assistant" && row.message) {
            const blocks = parseContent(row.message.content);
            for (const b of blocks) {
                onEvent({ type: "assistant_block", block: b });
                if (b.type === "text") finalText += b.text;
            }
            return;
        }

        if (row.type === "user" && row.message) {
            // headless 模式下 user 消息基本上就是 tool_result
            const blocks = parseContent(row.message.content);
            for (const b of blocks) {
                if (b.type === "tool_result") onEvent({ type: "tool_result", block: b });
            }
            return;
        }

        if (row.type === "result") {
            onEvent({
                type: "result",
                success: row.subtype === "success",
                finalText: row.result ?? finalText,
                sessionId: row.session_id ?? capturedSessionId,
                durationMs: row.duration_ms,
                costUsd: row.total_cost_usd,
                error: row.is_error ? (row.result ?? "error") : undefined,
            });
            return;
        }
    });

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (buf) => {
        const s = buf.toString();
        stderrChunks.push(s);
        // 只把非空 stderr 行往前端送(调试用)
        for (const line of s.split("\n")) {
            if (line.trim()) onEvent({ type: "stderr", line });
        }
    });

    await new Promise<void>((res) => {
        child.on("close", (code) => {
            Sessions.setBusy(sessionName, false);
            Sessions.touch(sessionName);
            if (aborted) {
                onEvent({ type: "error", message: "已中断" });
            } else if (code !== 0 && code !== null) {
                onEvent({
                    type: "error",
                    message: `claude 退出码 ${code}${stderrChunks.length ? ": " + stderrChunks.join("").slice(-500) : ""}`,
                });
            }
            onEvent({ type: "done" });
            res();
        });
        child.on("error", (e) => {
            Sessions.setBusy(sessionName, false);
            onEvent({ type: "error", message: `spawn error: ${e.message}` });
            onEvent({ type: "done" });
            res();
        });
    });
};
