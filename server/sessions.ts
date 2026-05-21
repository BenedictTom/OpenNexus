// 会话元数据 - 不再依赖 tmux
//
// v3 架构调整后:
//   - 创建会话 = 仅在 sessions.json 写一行 { name, path, claudeSessionId: null }
//   - 用户发消息 = 后端 spawn `claude -p --output-format stream-json` 子进程,
//                  首条消息从 system init 捕获 sessionId 写回
//   - 后续消息 = spawn `claude -p --resume <sid>` 续聊
//   - 历史 = 读 ~/.claude/projects/<encoded>/<sid>.jsonl (在 chat.ts 里)
//
// tmux 只在「分享 URL」场景临时 spawn,主线完全不用。

import { resolve, basename } from "node:path";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type SessionStatus = "idle" | "busy" | "dead";

export type SessionMeta = {
    name: string;
    path: string;
    claudeSessionId: string | null;  // 第一条消息后回填,允许为 null
    createdAt: number;
    lastActive: number;
};

export type SessionView = SessionMeta & { status: SessionStatus };

const STORE_PATH = resolve(import.meta.dir, "sessions.json");

// 正在跑 claude -p 子进程的 session 集合,用于 status 展示
const busySet = new Set<string>();

const loadStore = (): Record<string, SessionMeta> =>
    existsSync(STORE_PATH) ? JSON.parse(readFileSync(STORE_PATH, "utf8")) : {};

const saveStore = (store: Record<string, SessionMeta>): void =>
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));

const sanitizeName = (raw: string): string =>
    raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "session";

const uniqueName = (base: string, used: Set<string>): string => {
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base}-${i++}`;
    return name;
};

const statusOf = (m: SessionMeta): SessionStatus => {
    if (busySet.has(m.name)) return "busy";
    return "idle";
};

export const list = (): SessionView[] => {
    const store = loadStore();
    return Object.values(store)
        .sort((a, b) => b.lastActive - a.lastActive)
        .map((m) => ({ ...m, status: statusOf(m) }));
};

export const get = (name: string): SessionMeta | null => loadStore()[name] ?? null;

export type CreateError = "INVALID_PATH";

export const create = (
    path: string,
    label?: string,
): { name: string; path: string; claudeSessionId: null } | { error: CreateError } => {
    const abs = resolve(path);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return { error: "INVALID_PATH" };

    const store = loadStore();
    const baseName = sanitizeName(label?.trim() || basename(abs));
    const name = uniqueName(baseName, new Set(Object.keys(store)));

    const now = Date.now();
    store[name] = {
        name,
        path: abs,
        claudeSessionId: null,
        createdAt: now,
        lastActive: now,
    };
    saveStore(store);
    return { name, path: abs, claudeSessionId: null };
};

export const remove = (name: string): boolean => {
    const store = loadStore();
    if (!store[name]) return false;
    delete store[name];
    saveStore(store);
    busySet.delete(name);
    return true;
};

// chat.ts 在 spawn claude -p 后调用,记录 sessionId + lastActive
export const updateSessionId = (name: string, claudeSessionId: string): void => {
    const store = loadStore();
    if (!store[name]) return;
    store[name].claudeSessionId = claudeSessionId;
    store[name].lastActive = Date.now();
    saveStore(store);
};

export const touch = (name: string): void => {
    const store = loadStore();
    if (!store[name]) return;
    store[name].lastActive = Date.now();
    saveStore(store);
};

export const setBusy = (name: string, busy: boolean): void => {
    if (busy) busySet.add(name);
    else busySet.delete(name);
};

// 给 hook 用: 通过 cwd 反查 session 名(hook 上来的是 Claude 的 sid,需要别处映射)
export const findByCwd = (cwd: string): SessionMeta | null => {
    const abs = resolve(cwd);
    const store = loadStore();
    return Object.values(store).find((m) => m.path === abs) ?? null;
};

// 给 hook 用: 通过 Claude session_id 反查
export const findByClaudeSessionId = (sid: string): SessionMeta | null => {
    const store = loadStore();
    return Object.values(store).find((m) => m.claudeSessionId === sid) ?? null;
};

// 给老代码 sendKeys 留个兼容空实现,避免删完 hook 报错
// (主线已不用 tmux,permissions.ts 里只有审批回填,不需要按键注入)
export const sendKeys = (_name: string, _keys: string): boolean => false;
