#!/usr/bin/env python3
conf = '/etc/nginx/conf.d/teaching-workbench.conf'
block = """
    # WeChat ClawBot Agent Server
    location /wechat-agent/ {
        proxy_pass http://127.0.0.1:18080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_read_timeout 120s;
    }

"""
with open(conf) as f:
    content = f.read()

if 'wechat-agent' in content:
    print('already patched')
else:
    content = content.replace('    # SPA fallback', block + '    # SPA fallback', 1)
    with open(conf, 'w') as f:
        f.write(content)
    print('patched ok')
