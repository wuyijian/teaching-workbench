#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 教学工作台 WeChat Agent Server — 服务器部署脚本
# 在阿里云服务器上执行：bash deploy.sh
# ─────────────────────────────────────────────────────────────────────
set -e

AGENT_DIR="/opt/teaching-workbench/wechat-agent"
SERVICE_NAME="wechat-agent"

echo "==> 1. 安装 Node.js（若未安装）"
if ! command -v node &>/dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  yum install -y nodejs
fi
echo "    Node.js $(node -v) ✓"

echo "==> 2. 安装 pm2（进程管理）"
npm install -g pm2 2>/dev/null || true
echo "    pm2 $(pm2 -v) ✓"

echo "==> 3. 安装 weclaw"
npm install -g weclaw 2>/dev/null || true
echo "    weclaw $(weclaw --version 2>/dev/null || echo '已安装') ✓"

echo "==> 4. 创建 Agent Server 目录"
mkdir -p "$AGENT_DIR"

echo "==> 5. 上传文件（在本地执行 rsync，此处跳过）"
echo "    请在本地运行: rsync -avz wechat-agent/ root@47.242.163.135:${AGENT_DIR}/"

echo "==> 6. 安装依赖"
cd "$AGENT_DIR"
npm install --production

echo "==> 7. 检查 .env 文件"
if [ ! -f .env ]; then
  echo "⚠️  未找到 .env 文件，请先配置："
  echo "    cp .env.example .env && nano .env"
  exit 1
fi

echo "==> 8. 用 pm2 启动 Agent Server"
pm2 delete "$SERVICE_NAME" 2>/dev/null || true
pm2 start server.js --name "$SERVICE_NAME" --cwd "$AGENT_DIR"
pm2 save
pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true
echo "    Agent Server 已启动 ✓"

echo "==> 9. 更新 Nginx 配置"
NGINX_CONF="/etc/nginx/sites-available/teaching-workbench"
if [ -f "$NGINX_CONF" ]; then
  # 检查是否已有 wechat-agent location
  if grep -q "wechat-agent" "$NGINX_CONF"; then
    echo "    Nginx 配置已有 wechat-agent 块 ✓"
  else
    echo "    请手动在 Nginx 配置里添加 /wechat-agent/ 反代块（见 deploy/nginx.aliyun.conf）"
  fi
  nginx -t && systemctl reload nginx
  echo "    Nginx 重载 ✓"
fi

echo "==> 10. 配置 weclaw 并绑定微信"
WECLAW_DIR="$HOME/.weclaw"
mkdir -p "$WECLAW_DIR"
if [ ! -f "$WECLAW_DIR/config.json" ]; then
  cp "$AGENT_DIR/weclaw.config.json" "$WECLAW_DIR/config.json"
  echo "    weclaw 配置已写入 $WECLAW_DIR/config.json ✓"
fi

echo ""
echo "✅ 部署完成！"
echo ""
echo "下一步：扫码绑定微信"
echo "  weclaw login"
echo "  （终端会显示二维码，用微信扫码确认）"
echo ""
echo "验证连接："
echo "  weclaw status"
echo "  curl http://127.0.0.1:18080/health"
echo ""
echo "查看 Agent 日志："
echo "  pm2 logs wechat-agent"
