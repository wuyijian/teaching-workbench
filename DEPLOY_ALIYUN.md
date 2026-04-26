# 阿里云 Web 版部署手册

把 `dist/` 静态产物 + Nginx 反代部署到阿里云轻量应用服务器（或 ECS）。
全流程约 1–2 小时，其中域名备案另外算（个人备案 7–20 个工作日）。

## 0. 架构总览

```
浏览器（用户）
   │  HTTPS https://yixiaojian.top
   ▼
┌─────────────────────────────┐
│ 阿里云轻量服务器 (Ubuntu)   │
│ ├─ Nginx                    │
│ │  ├─ 静态：/var/www/teaching-workbench/  ← dist/ 上传到这里
│ │  ├─ 反代 /xfyun-api/  → office-api-ist-dx.iflyaisol.com
│ │  ├─ 反代 /moonshot-api/ → api.moonshot.cn
│ │  └─ 反代 /openai-api/   → api.openai.com（备用）
│ └─ Let's Encrypt 证书       │
└─────────────────────────────┘
            │
            ▼
       Supabase（托管，不用部）
       ├─ Auth / Database / Storage
       └─ Edge Functions（微信回调）
```

桌面端（DMG / Setup.exe）由用户本地安装，**不在此次部署范围**。

---

## 1. 准备清单

| 项目 | 说明 | 状态 / 何处办理 |
|---|---|---|
| 阿里云账号 | 实名认证 | aliyun.com |
| 服务器 | 轻量 2c2g 3M / 24元/月起 | 阿里云控制台 → 轻量应用服务器 |
| 域名 | **`yixiaojian.top`**（已购） | 阿里云 → 域名 |
| ICP 备案 | 国内服务器**强制**，海外/香港免备案 | 阿里云 → 备案 |
| Supabase | 已存在，复用即可 | supabase.com |
| `.env.production` | 本地构建时使用（**不要提交 git**） | 本地 |

> **省备案小技巧**：买**香港 / 新加坡**节点的轻量服务器，即买即用、无需备案，价格约贵 30%。
> 但 Kimi / 讯飞接口在境内，跨境会有少量延迟，介意的话还是走国内 + 备案。

---

## 2. 服务器购买与基础配置

### 2.1 买轻量应用服务器
- 控制台 → 轻量应用服务器 → 创建实例
- 镜像：**Ubuntu 24.04 LTS**（或 22.04）
- 套餐：2 核 2G、50G SSD、3M 带宽（24 元/月起）
- 防火墙开放：`22 / 80 / 443`

### 2.2 域名解析（yixiaojian.top）
- 阿里云 → 域名 → 域名列表 → 找到 `yixiaojian.top` → 解析
- 添加两条 A 记录：
  - 主机记录 `@`   → 记录值：服务器公网 IP（解析 `yixiaojian.top`）
  - 主机记录 `www` → 记录值：服务器公网 IP（解析 `www.yixiaojian.top`）
- TTL 默认 10 分钟即可
- 验证生效：本地 `nslookup yixiaojian.top` 能返回你的 IP（DNS 同步通常 5–30 分钟）

### 2.3 ICP 备案（仅国内服务器）
- 阿里云 → 备案 → 按向导走（`.top` 完全支持国内备案）
- 个人备案要求：身份证、手持照、座机或视频核验
- 期间网站不能开放，备案下来再继续 §3
- **想立即上线**：买香港节点轻量服务器，免备案；本手册步骤完全通用

---

## 3. 服务器初始化（一次性）

把仓库的 `deploy/` 目录上传到服务器，然后跑初始化脚本。

```bash
# 在你的本地电脑（Windows PowerShell 或 macOS / Linux 终端）：
scp -r deploy root@<你的服务器IP>:/root/

# SSH 进服务器
ssh root@<你的服务器IP>

# 域名 yixiaojian.top 已写死，只需改 EMAIL
nano /root/deploy/server-init.sh
# 把 EMAIL="you@example.com" 改成你的真实邮箱

# 一键初始化
bash /root/deploy/server-init.sh
```

脚本会做：

1. 安装 Nginx + certbot + ufw
2. 创建网站目录 `/var/www/teaching-workbench`
3. 写入 Nginx 配置（基于 `deploy/nginx.aliyun.conf` 模板）
4. 开启 UFW 防火墙
5. 申请 Let's Encrypt 证书 + 自动续期 + HTTP→HTTPS 重定向

成功后访问 `https://yixiaojian.top` 应能看到占位页 "Server initialized. Awaiting deployment."

---

## 4. 本地构建 + 上传（每次发版）

### 4.1 配置 `.env.production`

在仓库根目录创建 `.env.production`（**已加入 .gitignore，绝不能 commit**）：

```bash
# Supabase（与 .env 一致即可）
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# 讯飞企业版
VITE_XF_HOST=/xfyun-api
VITE_XF_APP_ID=cec900d8
VITE_XF_ACCESS_KEY_ID=...
VITE_XF_ACCESS_KEY_SECRET=...

# Kimi (Moonshot)
VITE_LLM_API_KEY=sk-...
VITE_LLM_BASE_URL=/moonshot-api/v1
VITE_LLM_MODEL=kimi-k2.5

# 微信登录（可选）
VITE_WECHAT_APP_ID=wx...
```

> ⚠️ **VITE_LLM_BASE_URL 必须用相对路径** `/moonshot-api/v1`，
> 直连 `https://api.moonshot.cn/v1` 浏览器会被 CORS 拦截。

### 4.2 一键发版

**Windows PowerShell：**
```powershell
# DEPLOY_HOST 默认已是 yixiaojian.top，直接跑即可
.\deploy\deploy.ps1

# 如需走 IP（备案前临时部署到香港节点等场景）：
# $env:DEPLOY_HOST = "1.2.3.4"
# .\deploy\deploy.ps1
```

**macOS / Linux / Git Bash：**
```bash
bash deploy/deploy.sh
# 或临时改目标：DEPLOY_HOST=1.2.3.4 bash deploy/deploy.sh
```

脚本会依次：

1. `npm run smoke` ─ 烟测（讯飞鉴权 + 大模型鉴权 + tsc 编译）
2. `npm run build:web` ─ 产出 `dist/`
3. 上传到服务器
4. `nginx -s reload`

---

## 5. 验收清单（每次发版后跑一遍）

完整内容见 `RELEASE_CHECKLIST.md`，核心 3 条：

- [ ] 打开 `https://yixiaojian.top` ─ 落地页正常
- [ ] 登录 → 上传一段 1 分钟测试音频 → 转写成功
- [ ] 用转写结果生成反馈 → 流式打字效果正常（不是几十秒后一次性出现）

第三条最容易出事，**如果反馈生成不是流式**，几乎一定是 Nginx `proxy_buffering off;` 没写或被覆盖了。检查 `/etc/nginx/sites-enabled/teaching-workbench` 中 `/moonshot-api/` 的配置块。

---

## 6. 微信登录（可选）

如果你已经接入微信开放平台 OAuth，部署到新域名后必须更新两处：

1. **微信开放平台 → 应用管理 → 网站应用 → 修改 → 授权回调域**
   填 `yixiaojian.top`（不带协议、不带 www）
2. **Supabase Dashboard → Auth → URL Configuration → Site URL & Redirect URLs**
   - Site URL：`https://yixiaojian.top`
   - Redirect URLs 添加：`https://yixiaojian.top/wechat-callback`、`https://yixiaojian.top/auth/callback`

---

## 7. 日常运维

### 查看日志
```bash
# 访问日志
tail -f /var/log/nginx/access.log

# 错误日志（502/504 优先看这个）
tail -f /var/log/nginx/error.log
```

### 改 Nginx 配置后
```bash
nginx -t                    # 一定先测试
systemctl reload nginx      # 平滑重载（不断连接）
```

### 证书续期
certbot 已自动配置 systemd timer，无需干预。手动测试：
```bash
certbot renew --dry-run
```

### 滚回上一版（紧急回滚）
建议每次发版前备份：
```bash
ssh root@<host> "cp -r /var/www/teaching-workbench /var/www/teaching-workbench.bak.$(date +%Y%m%d-%H%M)"
```
出问题时：
```bash
ssh root@<host> "rm -rf /var/www/teaching-workbench && mv /var/www/teaching-workbench.bak.<timestamp> /var/www/teaching-workbench && systemctl reload nginx"
```

---

## 8. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 刷新页面 404 | SPA fallback 没配 | 检查 nginx 里 `try_files $uri $uri/ /index.html;` |
| 反馈生成卡住几十秒 | proxy_buffering 没关 | `/moonshot-api/` 块里加 `proxy_buffering off;` |
| 转写上传失败 / 413 | 上传大小超限 | `client_max_body_size 500M;` |
| 浏览器报 CORS | LLM 配成了 https://api.moonshot.cn | 改回 `/moonshot-api/v1`，重新打包发版 |
| 麦克风权限拒绝 | 不是 HTTPS | 必须用 https，certbot 跑过没？ |
| 微信扫码后 redirect_uri error | 授权域没改 | §6 |
| `accessKeyId not exist` | 讯飞 key 错 / 没生效 | 服务器无关，检查 `.env.production` 重新打包 |

---

## 9. 进阶

### 9.1 GitHub Actions 自动部署（已配好）

工作流文件：`.github/workflows/deploy-web.yml`
触发：`push` 到 `main` 分支 / 手动 `workflow_dispatch`
流程：smoke → build → 备份服务器旧版 → rsync → reload nginx → 探活

#### 9.1.1 一次性准备（在你本机做）

**a. 生成专用部署密钥**（不要复用日常 SSH 密钥）：

```powershell
# Windows PowerShell
ssh-keygen -t ed25519 -f $HOME\.ssh\teaching-workbench-deploy -C "github-actions@yixiaojian.top" -N '""'
```
```bash
# macOS / Linux / Git Bash
ssh-keygen -t ed25519 -f ~/.ssh/teaching-workbench-deploy -C "github-actions@yixiaojian.top" -N ""
```

会生成两个文件：
- `teaching-workbench-deploy`     ─ **私钥**（待会贴到 GitHub Secret）
- `teaching-workbench-deploy.pub` ─ 公钥

**b. 把公钥加到服务器**：

```bash
# 把公钥内容追加到服务器 authorized_keys
ssh root@yixiaojian.top "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys" < ~/.ssh/teaching-workbench-deploy.pub
ssh root@yixiaojian.top "chmod 600 ~/.ssh/authorized_keys"
```

**c. 抓服务器 host key 指纹**（避免 GitHub Action 首跑卡在 known_hosts）：

```bash
ssh-keyscan -H yixiaojian.top
```
把整段输出（一般 3 行）保存下来，待会贴到 GitHub Secret `DEPLOY_KNOWN_HOSTS`。

#### 9.1.2 GitHub Secrets 清单

仓库 → Settings → Secrets and variables → Actions → New repository secret

**部署目标：**

| Secret | 值 |
|---|---|
| `DEPLOY_HOST` | `yixiaojian.top` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | 上一步 `teaching-workbench-deploy` 私钥**全文**（含 `-----BEGIN OPENSSH PRIVATE KEY-----`）|
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H yixiaojian.top` 的输出 |

**前端构建期变量**（这些会编译进 bundle，等同于公开常量；放进 Secrets 仅为不进 git 仓库）：

| Secret | 值 |
|---|---|
| `VITE_SUPABASE_URL` | https://xxxxx.supabase.co |
| `VITE_SUPABASE_ANON_KEY` | eyJhbGci... |
| `VITE_XF_APP_ID` | cec900d8 |
| `VITE_XF_ACCESS_KEY_ID` | 讯飞企业版 accessKeyId |
| `VITE_XF_ACCESS_KEY_SECRET` | 讯飞企业版 accessKeySecret |
| `VITE_LLM_API_KEY` | sk-xxx（Kimi）|
| `VITE_WECHAT_APP_ID` | wx...（可选，没接微信登录可不填）|
| `VITE_LLM_MODEL` | （可选，默认 `kimi-k2.5`）|

> ⚠️ **`VITE_LLM_BASE_URL` 和 `VITE_XF_HOST` 不要配 Secret**，工作流里已写死为 `/moonshot-api/v1` 和 `/xfyun-api`，避免误填成直连 URL 触发 CORS。

#### 9.1.3 上线前先手动跑一次

第一次跑建议手动触发，方便看日志：

1. 进 GitHub 仓库 → Actions → 选 **"Deploy Web to Aliyun"**
2. 点右上角 **Run workflow** → 选 main → Run
3. 看日志，重点关注三步：
   - `Smoke test` ─ 验证讯飞 / Kimi 密钥
   - `Sync dist to server` ─ 验证 SSH 通
   - `Health check` ─ 验证页面真的出来了

成功后再用日常 git push 触发，享受全自动部署。

#### 9.1.4 应急跳过 smoke

讯飞或 Kimi 偶发抽风时（鉴权过 99% 但偶尔超时），smoke 会让发版卡住。
此时手动触发并勾选 **"跳过 smoke 烟测"** 即可强行发布。

#### 9.1.5 紧急回滚

工作流每次发版都会在服务器留备份 `${DEPLOY_PATH}.bak.<timestamp>`（保留最近 5 份）。
回滚：

```bash
ssh root@yixiaojian.top
ls -1dt /var/www/teaching-workbench.bak.*    # 找到上一个好版本
rm -rf /var/www/teaching-workbench
mv /var/www/teaching-workbench.bak.<时间戳> /var/www/teaching-workbench
systemctl reload nginx
```

### 9.2 OSS + CDN（更便宜但更折腾）
- 静态托管 OSS bucket → CDN 加速 → 反代讯飞/Kimi 改用 Supabase Edge Function
- 月成本可压到 5–10 元，但增加 Edge Function 配置工作量
- 不推荐当前阶段使用

### 9.3 SAE（弹性应用引擎）
适合流量波动大、需要自动扩缩容的中后期场景。当前阶段轻量服务器足够。

### 9.2 OSS + CDN（更便宜但更折腾）
- 静态托管 OSS bucket → CDN 加速 → 反代讯飞/Kimi 改用 Supabase Edge Function
- 月成本可压到 5–10 元，但增加 Edge Function 配置工作量
- 不推荐当前阶段使用

### 9.3 SAE（弹性应用引擎）
适合流量波动大、需要自动扩缩容的中后期场景。当前阶段轻量服务器足够。
