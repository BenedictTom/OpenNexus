// 文件浏览 - 严格限定在某 session 的项目根下,不暴露盘外
//
// URL:
//   GET /files/<sessionName>/<rest...>          → 默认: 目录返 JSON, 文本文件返内容 JSON
//   GET /files/<sessionName>/<rest...>?raw=1    → 二进制原样返回(图片 src 用)

import { resolve, join, extname } from "node:path";
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { get as getSession } from "./sessions";

const HIDE = new Set([".git", "node_modules", ".DS_Store"]);

const TEXT_EXTS = new Set([
    "txt", "md", "markdown", "rst", "log",
    "js", "ts", "tsx", "jsx", "mjs", "cjs",
    "py", "rb", "go", "rs", "java", "kt", "kts", "scala", "swift",
    "c", "cc", "cpp", "h", "hpp", "m", "mm",
    "html", "htm", "css", "scss", "sass", "less",
    "json", "yaml", "yml", "toml", "ini", "conf", "properties",
    "xml", "svg", "vue", "astro",
    "sh", "bash", "zsh", "fish", "ps1",
    "sql", "graphql", "proto",
    "Dockerfile", "Makefile", "gitignore", "env",
]);

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

const MIME: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    bmp: "image/bmp", ico: "image/x-icon",
};

const MAX_TEXT_BYTES = 512 * 1024;       // 512 KB 以上仅截断显示
const MAX_BINARY_BYTES = 5 * 1024 * 1024; // 5 MB 以上 raw 也拒绝

export type FileEntry = {
    name: string;
    type: "dir" | "file";
    size: number;
    mtime: number;
};

const isInside = (root: string, target: string) =>
    target === root || target.startsWith(root + "/");

const fileKind = (name: string): "text" | "image" | "binary" => {
    const ext = extname(name).slice(1).toLowerCase();
    const base = name.toLowerCase();
    if (IMG_EXTS.has(ext)) return "image";
    if (TEXT_EXTS.has(ext)) return "text";
    // 一些没有扩展名但典型为文本的
    if (["dockerfile", "makefile", "rakefile", "gemfile"].includes(base)) return "text";
    return "binary";
};

export const listDir = (sessionName: string, sub: string): FileEntry[] | null => {
    const meta = getSession(sessionName);
    if (!meta) return null;
    const target = resolve(meta.path, sub);
    if (!isInside(meta.path, target)) return null;
    if (!existsSync(target)) return null;
    const st = statSync(target);
    if (!st.isDirectory()) return null;
    return readdirSync(target)
        .filter((n) => !HIDE.has(n))
        .map((n) => {
            const sst = statSync(join(target, n));
            return {
                name: n,
                type: sst.isDirectory() ? "dir" : "file",
                size: sst.size,
                mtime: sst.mtimeMs,
            };
        })
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
};

export type FileMeta = {
    type: "file";
    kind: "text" | "image" | "binary";
    path: string;
    name: string;
    bytes: number;
    ext: string;
    content?: string;       // text 时返回
    truncated?: boolean;    // 是否截断
};

export const readFileMeta = (sessionName: string, sub: string): FileMeta | null => {
    const meta = getSession(sessionName);
    if (!meta) return null;
    const target = resolve(meta.path, sub);
    if (!isInside(meta.path, target)) return null;
    if (!existsSync(target) || !statSync(target).isFile()) return null;

    const st = statSync(target);
    const name = target.split("/").pop() || target;
    const ext = extname(name).slice(1).toLowerCase();
    const kind = fileKind(name);

    const out: FileMeta = {
        type: "file",
        kind,
        path: sub,
        name,
        bytes: st.size,
        ext,
    };

    if (kind === "text") {
        const truncated = st.size > MAX_TEXT_BYTES;
        const buf = readFileSync(target);
        const slice = truncated ? buf.subarray(0, MAX_TEXT_BYTES) : buf;
        out.content = slice.toString("utf8");
        if (truncated) out.truncated = true;
    }
    // image / binary 由前端用 ?raw=1 拉
    return out;
};

export const readFileRaw = (
    sessionName: string,
    sub: string,
): { buf: Uint8Array; mime: string } | null => {
    const meta = getSession(sessionName);
    if (!meta) return null;
    const target = resolve(meta.path, sub);
    if (!isInside(meta.path, target)) return null;
    if (!existsSync(target) || !statSync(target).isFile()) return null;
    if (statSync(target).size > MAX_BINARY_BYTES) return null;

    const ext = extname(target).slice(1).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const buf = readFileSync(target);
    return { buf, mime };
};
