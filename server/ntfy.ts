// ntfy publish 客户端 - 推送通知到 ntfy.sh/<topic>

import { config } from "./config";

export type NtfyAction = {
    action: "view" | "http";
    label: string;
    url: string;
    method?: "GET" | "POST" | "PUT";
    body?: string;
    clear?: boolean;
};

export type NtfyMessage = {
    title: string;
    message: string;
    priority?: 1 | 2 | 3 | 4 | 5;
    tags?: string[];
    click?: string;
    actions?: NtfyAction[];
    // 关键: 让 APK 收到后能区分用途的标识
    headers?: Record<string, string>;
};

export const publish = async (msg: NtfyMessage): Promise<void> => {
    // JSON publish 必须 POST 到根路径 /,topic 在 body 里;
    // POST /<topic> 是文本模式,会把整个 body 当 message 字符串
    const url = config.ntfyServer;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(msg.headers ?? {}),
    };
    const body = JSON.stringify({
        topic: config.ntfyTopic,
        title: msg.title,
        message: msg.message,
        priority: msg.priority ?? 3,
        tags: msg.tags ?? [],
        click: msg.click,
        actions: msg.actions,
    });
    try {
        const r = await fetch(url, { method: "POST", headers, body });
        if (!r.ok) {
            console.error(`[ntfy] publish failed: ${r.status} ${await r.text()}`);
        }
    } catch (e) {
        console.error(`[ntfy] publish error:`, e);
    }
};
