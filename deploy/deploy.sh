#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 本地一键发版脚本（macOS / Linux / Git Bash / WSL）
# 流程：smoke → build:web → rsync 到服务器 → reload nginx
# 用法：
#   bash deploy/deploy.sh
# 首次运行前先 export 环境变量（或写入 ~/.bashrc）：
#   export DEPLOY_HOST=your-domain.com   # 或服务器 IP
#   export DEPLOY_USER=root
#   export DEPLOY_PATH=/var/www/teaching-workbench
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}▶ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

HOST="${DEPLOY_HOST:-yixiaojian.top}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${DEPLOY_PATH:-/var/www/teaching-workbench}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"

[[ -z "$HOST" ]] && die "请先 export DEPLOY_HOST=<域名> 或修改脚本默认值"

cd "$(dirname "$0")/.."
log "工作目录：$(pwd)"

if [[ "$SKIP_SMOKE" != "1" ]]; then
    log "[1/3] 烟测：tsc + 讯飞 + LLM"
    npm run smoke || die "smoke 失败，发版中止（如确认要跳过：SKIP_SMOKE=1 bash deploy/deploy.sh）"
else
    warn "[1/3] 已跳过 smoke（SKIP_SMOKE=1）"
fi

log "[2/3] 构建 Web 产物"
npm run build:web || die "构建失败"

log "[3/3] 上传 dist/ 到 ${USER}@${HOST}:${REMOTE_PATH}"
[[ -d dist ]] || die "dist/ 不存在"

# rsync 优先；没有就回退到 scp + ssh rm
if command -v rsync >/dev/null 2>&1; then
    rsync -avz --delete \
        --exclude='.DS_Store' \
        ./dist/ "${USER}@${HOST}:${REMOTE_PATH}/"
else
    warn "未找到 rsync，回退到 scp（不会清理服务器旧文件）"
    scp -r ./dist/* "${USER}@${HOST}:${REMOTE_PATH}/"
fi

log "修权限 + 重载 Nginx"
# scp/rsync 上传后目录可能 700（owner=root），nginx user 读不到 → 强制矫正
ssh "${USER}@${HOST}" "chown -R nginx:nginx '${REMOTE_PATH}' && chmod -R a+rX '${REMOTE_PATH}' && nginx -t && systemctl reload nginx" || warn "重载失败，请手动登录服务器检查"

log "✓ 发版完成 ─ https://${HOST}"
