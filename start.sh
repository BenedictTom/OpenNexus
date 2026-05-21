#!/usr/bin/env bash
# mobile-claude-console v3 - Tailscale + APK 模式
#
# 启动顺序:
#   1. ttyd       → 127.0.0.1:7681
#   2. 状态服务   → 127.0.0.1:9999
#   3. caddy      → :8080 (Tailnet 内 HTTP)
#
# 退出: Ctrl-C 一键停掉所有

set -e
cd "$(dirname "$0")"

cleanup() {
    echo ""
    echo "🛑 stopping services..."
    kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT

# ─── 0. 前置检查 ─────────────────────────────────────────
echo "🔎 检查依赖与配置"

for cmd in caddy tmux bun jq; do
    if ! command -v $cmd >/dev/null; then
        echo "❌ 缺失: $cmd  (brew install $cmd)"
        exit 1
    fi
done
# ttyd 仅分享 URL 用,缺了主线也能跑,只是分享功能不可用
if ! command -v ttyd >/dev/null; then
    echo "   ⚠️  ttyd 未安装,分享 URL 功能将不可用 (brew install ttyd)"
fi

if [[ ! -f mcc.config.json ]]; then
    echo "❌ 缺 mcc.config.json,先复制 mcc.config.example.json 填写"
    exit 1
fi

# Tailscale 状态
if tailscale status >/dev/null 2>&1; then
    TS_NAME=$(tailscale status --self --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
    echo "   Tailscale: ✅ ${TS_NAME:-unknown}"
else
    echo "   Tailscale: ⚠️  未运行,APK 会连不通 (打开 /Applications/Tailscale.app 登录后再启动)"
fi

# 解析端口
STATE_PORT=$(jq -r '.ports.state // 9999' mcc.config.json)

# ─── 1. 状态服务 ──────────────────────────────────────────
# v3.1 起主线为聊天 UI(claude -p stream-json),不再常驻 ttyd
# ttyd 仅在用户点「分享 URL」时按需 spawn,由状态服务托管
echo "🚀 [1/2] state svc → 127.0.0.1:${STATE_PORT}"
bun run server/index.ts 2>&1 | sed 's/^/  [state] /' &

sleep 1

# ─── 2. caddy ─────────────────────────────────────────────
echo "🚀 [2/2] caddy → :8080"
caddy run --config Caddyfile 2>&1 | sed 's/^/  [caddy] /' &

echo ""
if [[ -n "$TS_NAME" ]]; then
    echo "✅ 全部启动. 手机访问: http://${TS_NAME}:8080/"
else
    echo "✅ 全部启动. 本机自测: http://127.0.0.1:8080/"
fi
echo "    Ctrl-C 停止"
echo ""

wait
