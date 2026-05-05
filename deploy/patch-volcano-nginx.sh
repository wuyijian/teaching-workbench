#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 幂等地往生产 nginx 配置里注入 /volcano-api/ 反代规则。
# 由 .github/workflows/deploy-web.yml 在每次部署时 scp+ssh 调用。
# 不会动 certbot 维护的 SSL 证书行；命中后立刻退出。
# ─────────────────────────────────────────────────────────────────────
set -e

echo "===== nginx config diagnostics ====="
echo "[1] nginx -V conf-path:"
nginx -V 2>&1 | grep -oE -- '--conf-path=[^ ]+' || true
echo "[2] /etc/nginx tree:"
ls -la /etc/nginx/ 2>/dev/null || true
echo "[3] /etc/nginx/conf.d:"
ls -la /etc/nginx/conf.d/ 2>/dev/null || true
echo "[4] /etc/nginx/sites-enabled:"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
echo "[5] /etc/nginx/sites-available:"
ls -la /etc/nginx/sites-available/ 2>/dev/null || true
echo "===================================="

# 在所有 .conf 文件（排除 .bak.* 备份）里找含域名的，优先 conf.d/teaching-workbench.conf
PRIMARY=/etc/nginx/conf.d/teaching-workbench.conf
if [ -f "$PRIMARY" ] && grep -q "yixiaojian.top" "$PRIMARY"; then
  CONF="$PRIMARY"
else
  CONF=$(find /etc/nginx -type f -name '*.conf' \
    -exec grep -lE "server_name[^;]*yixiaojian\.top" {} + 2>/dev/null \
    | grep -v '\.bak' | head -n1)
fi

if [ -z "$CONF" ]; then
  echo "未找到含 yixiaojian.top 的 nginx server 配置文件，跳过"
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

block = '''
    # ── 火山引擎豆包大模型录音转写反代 ──
    location /volcano-api/ {
        proxy_pass https://openspeech.bytedance.com/;
        proxy_ssl_server_name on;
        proxy_set_header Host openspeech.bytedance.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        client_max_body_size    100M;
        proxy_request_buffering off;
        client_body_timeout     600s;
        send_timeout            600s;
        proxy_connect_timeout   30s;
        proxy_send_timeout      600s;
        proxy_read_timeout      600s;
    }
'''

# 优先匹配含 yixiaojian.top 的 server 块的第一处 location；找不到就退到任意 server 块
patterns = [
    r'(server\s*\{[^}]*?server_name[^;]*yixiaojian\.top[^}]*?listen\s+443\s+ssl[^}]*?)(\n\s*location\s+/)',
    r'(server\s*\{[^}]*?listen\s+443\s+ssl[^}]*?server_name[^;]*yixiaojian\.top[^}]*?)(\n\s*location\s+/)',
    r'(server\s*\{[^}]*?listen\s+443\s+ssl[^}]*?)(\n\s*location\s+/)',
    r'(server\s*\{[^}]*?ssl_certificate[^}]*?)(\n\s*location\s+/)',
    r'(server\s*\{[^}]*?server_name[^;]*yixiaojian\.top[^}]*?)(\n\s*location\s+/)',
]
m = None
for pat in patterns:
    m = re.search(pat, src, re.DOTALL)
    if m:
        break

if not m:
    print('无法定位 server 块第一处 location', file=sys.stderr)
    sys.exit(1)

new_src = src[:m.end(1)] + block + src[m.end(1):]
with open(conf, 'w', encoding='utf-8') as f:
    f.write(new_src)
print('已注入 /volcano-api/ location 到', conf)
PY

echo "验证 nginx 配置语法..."
nginx -t
echo "patch 完成"
