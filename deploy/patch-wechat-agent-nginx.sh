#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 幂等地往生产 nginx 配置里注入 /wechat-agent/ 反代规则。
# wechat-agent Express 服务运行在 127.0.0.1:18080。
# 由 .github/workflows/deploy-web.yml 在每次部署时 scp+ssh 调用。
# 不会动 certbot 维护的 SSL 证书行；命中后立刻退出。
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

if grep -q "/wechat-agent/" "$CONF"; then
  echo "/wechat-agent/ 已存在，跳过 patch"
  exit 0
fi

cp "$CONF" "$CONF.bak.$(date +%s)"

export CONF_PATH="$CONF"
python3 <<'PY'
import os, re, sys
conf = os.environ['CONF_PATH']
with open(conf, 'r', encoding='utf-8') as f:
    src = f.read()

block = '''    # ── wechat-agent 主动推送反代（Express 监听 127.0.0.1:18080）──
    location /wechat-agent/ {
        proxy_pass http://127.0.0.1:18080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_connect_timeout 10s;
    }

'''

# 锚点 1：在 /xfyun-api/ location 前面插入（保证落在 HTTPS server 块内）
anchor1 = '    location /xfyun-api/'
# 锚点 2（兜底）：在 /volcano-api/ 前面插入
anchor2 = '    location /volcano-api/'
# 锚点 3（最终兜底）：在最后一个 server 块的末尾 } 前插入
#   取最后一个 "}" 之前的位置，适合大多数 nginx 单 server 块配置

if anchor1 in src:
    anchor = anchor1
elif anchor2 in src:
    anchor = anchor2
else:
    anchor = None

if anchor:
    new_src = src.replace(anchor, block + anchor, 1)
else:
    # 在文件末尾最后一个 "}" 前插入（假设整个文件就是一个 server 块）
    last_brace = src.rfind('\n}')
    if last_brace == -1:
        print('未找到任何已知锚点且文件结构异常，无法自动注入', file=sys.stderr)
        sys.exit(1)
    new_src = src[:last_brace] + '\n' + block.rstrip() + '\n' + src[last_brace:]

if new_src == src:
    print('替换未生效', file=sys.stderr)
    sys.exit(1)

with open(conf, 'w', encoding='utf-8') as f:
    f.write(new_src)
print('已注入 /wechat-agent/ location 到', conf)
PY

echo "验证 nginx 配置语法..."
nginx -t
echo "patch 完成"
