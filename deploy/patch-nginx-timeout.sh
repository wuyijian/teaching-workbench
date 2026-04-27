#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 一次性 patch：给现有 nginx config 注入"慢网络上传超时"指令
# 解决 28MB+ 音频 POST /xfyun-api/v2/upload 返回 408 的问题
#
# 用法：bash patch-nginx-timeout.sh
#   - 自动备份原文件到 .bak.<时间戳>
#   - 用 Python 做幂等 patch（重复执行无副作用）
#   - nginx -t 通过才 reload
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

CONF=/etc/nginx/conf.d/teaching-workbench.conf

if [[ ! -f "$CONF" ]]; then
  echo "✗ 找不到 $CONF" >&2
  exit 1
fi

BAK="${CONF}.bak.$(date +%s)"
cp -a "$CONF" "$BAK"
echo "✓ 备份至 $BAK"

python3 - "$CONF" <<'PYEOF'
import sys, re

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
orig = src

# ─── Patch 1: server 块顶部（client_body_buffer_size 之后）──────────────────
server_block_inject = """    client_body_timeout        600s;
    client_header_timeout      60s;
    send_timeout               600s;
"""

if 'client_body_timeout        600s' not in src:
    pat = re.compile(r'(    client_body_buffer_size 1M;\n)', re.M)
    if pat.search(src):
        src = pat.sub(r'\1' + server_block_inject, src, count=1)
        print('✓ Patch 1: server 块超时已注入')
    else:
        print('⚠ 没找到 client_body_buffer_size 1M; 锚点，跳过 Patch 1')
else:
    print('= Patch 1: 已存在，跳过')

# ─── Patch 2: /xfyun-api/ 块（proxy_request_buffering off 之后）──────────────
# 仅在 xfyun 块内注入；用范围正则定位
xfyun_inject = """
        # 慢网络容忍：客户端大文件上行可能要数分钟，避免 nginx 中途 408
        # 注：client_header_timeout 不允许在 location 上下文，只在 server 块设
        client_body_timeout        600s;
        send_timeout               600s;
"""

xfyun_block_re = re.compile(
    r'(location /xfyun-api/ \{[^}]*?proxy_request_buffering off;\n)',
    re.S,
)

m = xfyun_block_re.search(src)
if m:
    if 'client_body_timeout        600s' in src[m.start():m.end()+200]:
        # 已经在 xfyun 块附近注入过
        existing = src.count('client_body_timeout        600s')
        if existing >= 2:
            print('= Patch 2: 已存在，跳过')
        else:
            src = src.replace(m.group(1), m.group(1) + xfyun_inject, 1)
            print('✓ Patch 2: /xfyun-api/ 块超时已注入')
    else:
        src = src.replace(m.group(1), m.group(1) + xfyun_inject, 1)
        print('✓ Patch 2: /xfyun-api/ 块超时已注入')
else:
    print('⚠ 没找到 /xfyun-api/ 块，跳过 Patch 2')

if src != orig:
    open(path, 'w', encoding='utf-8').write(src)
    print('✓ 配置文件已更新')
else:
    print('= 配置文件无变化')

count = src.count('client_body_timeout        600s')
print(f'最终 client_body_timeout 出现次数：{count}（期望 2）')
PYEOF

echo
echo "=== nginx -t ==="
if nginx -t; then
  echo "=== reload ==="
  systemctl reload nginx
  echo "✓ reload OK"
else
  echo "✗ nginx -t 失败，从备份恢复"
  cp -a "$BAK" "$CONF"
  nginx -t && systemctl reload nginx
  exit 1
fi
