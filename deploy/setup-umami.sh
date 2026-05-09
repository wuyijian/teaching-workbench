#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 一键在阿里云香港服务器上部署自托管 Umami 流量分析
#
# 使用方法（服务器上执行一次）：
#   sudo bash /tmp/setup-umami.sh
#
# 完成后：
#   1. 访问 https://yixiaojian.top/umami/
#   2. 用 admin / umami 登录，立即改密码
#   3. 添加网站 yixiaojian.top，复制 Website ID
#   4. 把 Website ID 加到 GitHub Secrets: VITE_UMAMI_WEBSITE_ID
#   5. 重新部署（push 一个空 commit 或手动触发 Actions）
# ─────────────────────────────────────────────────────────────────────
set -e

UMAMI_DIR=/opt/umami

# 找 nginx 主配置文件（排除备份）
NGINX_CONF=$(grep -lrE "server_name[^;]*yixiaojian\.top" /etc/nginx/ 2>/dev/null \
  | grep -v '\.bak\.' | head -n1)

echo "=========================================="
echo "  Umami 自托管安装脚本"
echo "=========================================="
echo ""

# ── 1. Docker ─────────────────────────────────────────────────────────
echo "[1/4] 检查 Docker 环境..."

if ! command -v docker &>/dev/null; then
  echo "  安装 Docker（使用官方一键脚本）..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  Docker 安装完成"
else
  echo "  Docker 已就绪: $(docker --version)"
fi

# Docker Compose（优先用 plugin 形式）
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif docker-compose version &>/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "  安装 docker-compose-plugin..."
  (apt-get install -y docker-compose-plugin 2>/dev/null) \
  || (yum install -y docker-compose-plugin 2>/dev/null) \
  || {
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
      -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
  }
  DC="docker-compose"
fi
echo "  Compose 命令: $DC"

# ── 2. 创建 Umami 配置 ────────────────────────────────────────────────
echo ""
echo "[2/4] 创建 Umami 配置..."

mkdir -p "$UMAMI_DIR"

if [ ! -f "$UMAMI_DIR/.env" ]; then
  PG_PASS=$(openssl rand -hex 16)
  APP_SECRET=$(openssl rand -hex 32)
  cat > "$UMAMI_DIR/.env" <<EOF
POSTGRES_PASSWORD=${PG_PASS}
APP_SECRET=${APP_SECRET}
EOF
  echo "  已生成随机密钥 → $UMAMI_DIR/.env"
else
  echo "  .env 已存在，跳过密钥生成"
fi

cat > "$UMAMI_DIR/docker-compose.yml" <<'COMPOSE'
version: '3'
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    ports:
      - "127.0.0.1:3001:3000"
    environment:
      DATABASE_URL: postgresql://umami:${POSTGRES_PASSWORD}@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: ${APP_SECRET}
      BASE_PATH: /umami
    depends_on:
      db:
        condition: service_healthy
    restart: always

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - umami-db-data:/var/lib/postgresql/data
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  umami-db-data:
COMPOSE

echo "  docker-compose.yml 已写入"

# ── 3. 启动容器 ───────────────────────────────────────────────────────
echo ""
echo "[3/4] 启动 Umami 容器（首次拉取镜像约需 1-2 分钟）..."

cd "$UMAMI_DIR"
$DC up -d

echo "  等待 Umami 初始化（约 30 秒）..."
for i in $(seq 1 6); do
  sleep 10
  if curl -sf http://127.0.0.1:3001/umami/ >/dev/null 2>&1; then
    echo "  Umami 已启动 ✓"
    break
  fi
  echo "  ... 等待中（${i}/6）"
done

if ! curl -sf http://127.0.0.1:3001/umami/ >/dev/null 2>&1; then
  echo "  ⚠ Umami 可能仍在初始化，稍等片刻后访问即可"
fi

# ── 4. 注入 nginx /umami/ 反代 ────────────────────────────────────────
echo ""
echo "[4/4] 注入 nginx /umami/ 反代..."

if [ -z "$NGINX_CONF" ]; then
  echo "  ⚠ 未找到 nginx 配置，请手动添加以下 location 块："
  cat <<'BLOCK'
    location /umami/ {
        proxy_pass http://127.0.0.1:3001/umami/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }
BLOCK
else
  echo "  Target: $NGINX_CONF"

  if grep -q "location /umami/" "$NGINX_CONF"; then
    echo "  /umami/ 已存在，跳过"
  else
    cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%s)"
    python3 <<PY
import re
conf = "$NGINX_CONF"
with open(conf) as f: src = f.read()

block = """    # ── Umami 流量分析反代 ──
    location /umami/ {
        proxy_pass http://127.0.0.1:3001/umami/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }

"""
anchor = "    location /xfyun-api/"
new = src.replace(anchor, block + anchor, 1)
if new == src:
    anchor = "    location /volcano-api/"
    new = src.replace(anchor, block + anchor, 1)
if new == src:
    print("未找到锚点，请手动插入 location 块"); exit(1)
with open(conf, "w") as f: f.write(new)
print("  /umami/ 反代已注入")
PY
    nginx -t && systemctl reload nginx
    echo "  nginx 已重载 ✓"
  fi
fi

# ── 完成提示 ──────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Umami 部署完成！"
echo ""
echo "  访问：https://yixiaojian.top/umami/"
echo "  账号：admin"
echo "  密码：umami  ← 请立即修改！"
echo ""
echo "  后续步骤："
echo "  1. 登录 → 设置 → 添加网站 yixiaojian.top"
echo "  2. 复制 Website ID"
echo "  3. GitHub Repo → Settings → Secrets → New:"
echo "       Name:  VITE_UMAMI_WEBSITE_ID"
echo "       Value: <你的 Website ID>"
echo "  4. 重新部署（push 任意提交触发 CI）"
echo "=========================================="
