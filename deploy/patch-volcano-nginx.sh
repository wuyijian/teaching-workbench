#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 幂等地往生产 nginx 配置里注入 /volcano-api/ 反代规则。
# 由 .github/workflows/deploy-web.yml 在每次部署时 scp+ssh 调用。
# 不会动 certbot 维护的 SSL 证书行；命中后立刻退出。
#
# 注意：必须排除 *.bak.* 备份文件，否则可能 patch 错文件。
# ─────────────────────────────────────────────────────────────────────
set -e

# 候选搜索路径：含 yixiaojian.top 但不是备份文件的最浅路径
CANDIDATES=(
  /etc/nginx/conf.d/teaching-workbench.conf
  /etc/nginx/sites-enabled/teaching-workbench
  /etc/nginx/sites-enabled/teaching-workbench.conf
)

CONF=""
for c in "${CANDIDATES[@]}"; do
  if [ -f "$c" ] && grep -q "yixiaojian.top" "$c"; then
    CONF="$c"
    break
  fi
done

if [ -z "$CONF" ]; then
  # 兜底：grep 全局搜，但跳过 *.bak.*
  CONF=$(grep -lrE "server_name[^;]*yixiaojian\.top" /etc/nginx/ 2>/dev/null \
    | grep -v '\.bak\.' \
    | head -n1)
fi

if [ -z "$CONF" ]; then
  echo "未找到含 yixiaojian.top 的非备份 nginx 配置，跳过"
  echo "[diag] /etc/nginx/conf.d:"; ls -la /etc/nginx/conf.d/ 2>/dev/null || true
  echo "[diag] /etc/nginx/sites-enabled:"; ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
  exit 0
fi

echo "Target nginx config: $CONF"

if grep -q "/volcano-api/" "$CONF"; then
  echo "/volcano-api/ 已存在，跳过 patch"
  exit 0
fi

cp "$CONF" "$CONF.bak.$(date +%s)"

export CONF_PATH="$CONF"
python3 <<'PY'
import os, re, sys
conf = os.environ['CONF_PATH']
with open(conf, 'r', encoding='utf-8') as f:
    src = f.read()

block = '''    # ── 火山引擎豆包大模型录音转写反代 ──
    location /volcano-api/ {
        proxy_pass https://openspeech.bytedance.com/;
        proxy_ssl_server_name on;
        proxy_set_header Host openspeech.bytedance.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        client_max_body_size    500M;
        proxy_request_buffering off;
        client_body_timeout     600s;
        send_timeout            600s;
        proxy_connect_timeout   30s;
        proxy_send_timeout      600s;
        proxy_read_timeout      600s;
    }

'''

# 锚点：在 /xfyun-api/ location 前面插入（保证落在 HTTPS server 块内的转写反代区域）
anchor = '    location /xfyun-api/'
if anchor not in src:
    print('未找到锚点 /xfyun-api/，可能配置已变更', file=sys.stderr)
    sys.exit(1)

new_src = src.replace(anchor, block + anchor, 1)
if new_src == src:
    print('替换未生效', file=sys.stderr)
    sys.exit(1)

with open(conf, 'w', encoding='utf-8') as f:
    f.write(new_src)
print('已注入 /volcano-api/ location 到', conf)
PY

echo "验证 nginx 配置语法..."
nginx -t
echo "patch 完成"
