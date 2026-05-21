// 配置加载 - 单例,启动时读一次

import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type Config = {
    ntfyTopic: string;
    ntfyServer: string;
    ports: { ttyd: number; state: number; caddy: number };
    permissionTimeoutSec: number;
    tailscaleHostname: string;
};

const defaults: Omit<Config, "ntfyTopic"> = {
    ntfyServer: "https://ntfy.sh",
    ports: { ttyd: 7681, state: 9999, caddy: 8080 },
    permissionTimeoutSec: 55,
    tailscaleHostname: "",
};

const loadConfig = (): Config => {
    const path = resolve(process.cwd(), "mcc.config.json");
    if (!existsSync(path)) {
        throw new Error(`mcc.config.json 不存在: ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw.ntfyTopic || raw.ntfyTopic.includes("REPLACE")) {
        throw new Error("mcc.config.json 中 ntfyTopic 未配置");
    }

    return {
        ...defaults,
        ...raw,
        ports: { ...defaults.ports, ...(raw.ports ?? {}) },
    };
};

export const config: Config = loadConfig();
