// 审批挂起 + 决策接收
//
// hook 端: 通过 POST /api/permission 注册请求, 然后阻塞读取 /tmp/mcc-decision-<id>
// APK 端: 收到 ntfy 通知 → 用户点按钮 → POST /api/permission/<id>/decision
// 状态服务: 写文件唤醒 hook,并通过 SSE 广播给 web UI

import { writeFileSync } from "node:fs";
import { publish } from "./ntfy";
import { config } from "./config";
import { broadcast } from "./events";
import { findByCwd } from "./sessions";

export type PermissionChoice = "allow" | "deny" | "always" | "ask";

export type PermissionRequest = {
    id: string;
    sessionId: string;          // Claude 的 session UUID
    sessionName: string | null; // 我们的 tmux 名(可能 null)
    cwd: string;
    toolName: string;
    toolInput: unknown;
    description: string;        // 给手机展示的简短描述
    createdAt: number;
};

export type PermissionResolved = PermissionRequest & {
    choice: PermissionChoice;
    reason?: string;
    resolvedAt: number;
};

const pending = new Map<string, PermissionRequest>();
const resolved = new Map<string, PermissionResolved>();

// 决策唤醒文件: 强制 /tmp,避免 macOS 上 os.tmpdir() 返回 /var/folders/... 与 hook 子进程不一致
const decisionFile = (id: string) => `/tmp/mcc-decision-${id}`;

// 从 tool_input 推导通知文案 + 简短摘要
const summarize = (tool: string, input: any): string => {
    if (tool === "Bash") return `$ ${(input?.command ?? "").slice(0, 200)}`;
    if (tool === "Edit" || tool === "Write") return `${tool} ${input?.file_path ?? ""}`;
    if (tool === "Read") return `Read ${input?.file_path ?? ""}`;
    return `${tool}: ${JSON.stringify(input).slice(0, 120)}`;
};

const buildActions = (id: string): { action: "http"; label: string; url: string; method: "POST"; body: string }[] => {
    const base = config.tailscaleHostname
        ? `http://${config.tailscaleHostname}:${config.ports.caddy}/api/permission/${id}/decision`
        : `http://localhost:${config.ports.caddy}/api/permission/${id}/decision`;
    const mk = (label: string, choice: PermissionChoice) => ({
        action: "http" as const,
        label,
        url: base,
        method: "POST" as const,
        body: JSON.stringify({ choice }),
    });
    return [mk("允许", "allow"), mk("拒绝", "deny"), mk("始终允许", "always")];
};

export const createRequest = async (input: {
    id: string;
    sessionId: string;
    cwd: string;
    toolName: string;
    toolInput: unknown;
}): Promise<PermissionRequest> => {
    const session = findByCwd(input.cwd);
    const req: PermissionRequest = {
        ...input,
        sessionName: session?.name ?? null,
        description: summarize(input.toolName, input.toolInput),
        createdAt: Date.now(),
    };
    pending.set(req.id, req);

    // 推送到手机
    await publish({
        title: `${session?.name ?? "Claude"} 想执行 ${input.toolName}`,
        message: req.description,
        priority: 4,
        tags: ["warning"],
        click: `mcc://session/${session?.name ?? "default"}`,
        actions: buildActions(req.id),
    });

    broadcast({ type: "permission_pending", request: req });
    return req;
};

export const resolveRequest = (id: string, choice: PermissionChoice, reason?: string): PermissionResolved | null => {
    const req = pending.get(id);
    if (!req) return null;
    pending.delete(id);

    const res: PermissionResolved = { ...req, choice, reason, resolvedAt: Date.now() };
    resolved.set(id, res);

    // 写文件唤醒挂起的 hook
    writeFileSync(decisionFile(id), JSON.stringify({ choice, reason }));

    broadcast({ type: "permission_resolved", request: res });
    return res;
};

export const listPending = (): PermissionRequest[] => Array.from(pending.values());

export const getRequest = (id: string): PermissionRequest | PermissionResolved | null =>
    pending.get(id) ?? resolved.get(id) ?? null;
