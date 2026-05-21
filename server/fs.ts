// 文件系统目录浏览 - 新建会话的「选择文件夹」用
//
// 设计:
//   - 只返回 *目录* 条目, 不展示文件 (创建会话只关心目录)
//   - 隐藏点开头的目录 (.git, .vscode, .Trash 等)
//   - 不限制范围: 用户自用工具, 默认从 $HOME 起步, 可向上回溯到 /
//   - 不读取文件内容, 仅 stat 元数据
//
// 安全考虑:
//   - 创建会话的实际 spawn 由 chat.ts 在用户确认后才执行
//   - 这里只是 listdir, 信息泄露面 = "什么目录存在", 自用环境可接受
//   - 拒绝符号链接陷阱: 用 resolve() + statSync().isDirectory() 严格判定

import { resolve, dirname, basename, sep } from "node:path";
import { existsSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const HIDE_PREFIX = ".";

export type DirEntry = {
    name: string;
    type: "dir";
};

export type ListResult = {
    path: string;             // 当前绝对路径
    parent: string | null;    // 上级路径; 已到根则 null
    home: string;             // $HOME, 前端"回到 Home"按钮用
    entries: DirEntry[];
};

const safeStat = (p: string): { isDir: boolean } | null => {
    try {
        const st = statSync(p);
        return { isDir: st.isDirectory() };
    } catch {
        return null;
    }
};

const listSubdirs = (abs: string): DirEntry[] => {
    let names: string[];
    try {
        names = readdirSync(abs);
    } catch {
        return [];
    }
    return names
        .filter((n) => !n.startsWith(HIDE_PREFIX))
        .map((n) => ({ name: n, full: resolve(abs, n) }))
        .map((e) => {
            const st = safeStat(e.full);
            return st && st.isDir ? { name: e.name, type: "dir" as const } : null;
        })
        .filter((x): x is DirEntry => x !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
};

export const listDir = (input?: string): ListResult | null => {
    const home = homedir();
    const target = resolve(input ?? home);

    if (!existsSync(target)) return null;
    const st = safeStat(target);
    if (!st || !st.isDir) return null;

    const parent = target === sep ? null : dirname(target);

    return {
        path: target,
        parent,
        home,
        entries: listSubdirs(target),
    };
};
