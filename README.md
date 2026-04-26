# 语文教学工作台

音频转写 + AI 课堂反馈 + 学生档案 + Agent 对话的语文教学辅助工具。订阅制（探索 / 专业 / 机构三档），通过激活码升级。

## 仓库结构（简要）

| 路径 | 说明 |
|------|------|
| `src/config/` | `app` 运行环境；`platformApi` 从 `VITE_*` 注入大模型与讯飞；`urls` 反代基址 |
| `src/context/` | `AuthContext`、`SubscriptionContext`（登录、订阅、配额、激活码兑换） |
| `src/agent/` | Agent 工具与 `useAgent` 对话循环 |
| `src/components/UpgradeModal.tsx` | 升级方案弹窗 + 激活码兑换 UI |
| `supabase/migrations/` | 数据库迁移（按编号顺序在 Supabase SQL Editor 中执行） |
| `supabase/functions/` | Edge Functions（如微信 OAuth 回调） |
| `scripts/gen-redeem-codes.mjs` | 管理员批量生成激活码 |
| `scripts/test-redeem.mjs` | 端到端验证兑换闭环 |
| `electron/` | 桌面端主进程与 preload |

**配置约定**：大模型与讯飞凭据只在构建/部署环境变量中设置，用户侧「设置」仅保留课堂反馈 Prompt 等偏好。

## 部署环境变量

复制 `.env.example` 为 `.env` 或在托管平台（Vercel / Netlify）配置同名字段。

### 前端（`VITE_*`，参与构建）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_LLM_API_KEY` | ✅ | OpenAI 兼容大模型 key（推荐 Kimi） |
| `VITE_LLM_BASE_URL` | ✅ | dev 用 `/moonshot-api/v1`，生产用同域反代路径 |
| `VITE_LLM_MODEL` | ✅ | 模型名，默认 `kimi-k2.5` |
| `VITE_XF_APP_ID` | ✅ | 讯飞「录音文件转写」APP_ID |
| `VITE_XF_ACCESS_KEY_ID` | ✅ | 讯飞 AccessKeyId |
| `VITE_XF_ACCESS_KEY_SECRET` | ✅ | 讯飞 AccessKeySecret |
| `VITE_SUPABASE_URL` | 可选 | Supabase 项目 URL（启用登录注册时必填） |
| `VITE_SUPABASE_ANON_KEY` | 可选 | Supabase anon key |
| `VITE_WECHAT_APP_ID` | 可选 | 微信开放平台 AppID（启用微信登录时） |

### 管理员脚本（仅本机使用，**绝不进 git 与前端**）

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | 同上（脚本使用 raw URL） |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key —— 上帝权限，仅用于 `scripts/*.mjs` |
| `SUPABASE_ANON_KEY` | 测试脚本登录测试用户用 |

### Supabase Edge Function Secrets

在 Supabase Dashboard → Edge Functions → Secrets 中配置：

| 变量 | 用途 |
|------|------|
| `WECHAT_APP_ID` | 微信开放平台 AppID |
| `WECHAT_APP_SECRET` | 微信开放平台 AppSecret |
| `ALLOWED_ORIGINS` | **生产必填**：允许的前端域名，逗号分隔。未配置时仅放行 `localhost`（CORS 安全） |

## 数据库迁移（按顺序执行）

进入 [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new)，**依次**粘贴以下文件全文，每次点 Run：

1. `supabase/migrations/001_user_profiles.sql` —— 用户资料表
2. `supabase/migrations/002_subscriptions.sql` —— 订阅与配额表 + 自动建行触发器
3. `supabase/migrations/003_redeem_codes.sql` —— 激活码表 + `redeem_code` RPC
4. `supabase/migrations/004_secure_subscriptions.sql` —— **重要**：撤销用户对订阅表的直连 UPDATE，扣量改走 `consume_quota` RPC

跳过 004 会留下严重安全漏洞（用户可绕过付费自改 plan）。

验证迁移成功：

```bash
# 本机设置环境变量后跑
node scripts/test-redeem.mjs <某张激活码>
```

应输出 `✅ All assertions passed.`

## 激活码（订阅运营）

### 生成

```powershell
$env:SUPABASE_URL = "https://xxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role_key>"

# 生成 10 张专业版月卡（30 天，每月 1200 分钟即 20 小时）
node scripts/gen-redeem-codes.mjs --plan pro --count 10 --days 30 --note "渠道A"

# 生成 5 张专业版年卡
node scripts/gen-redeem-codes.mjs --plan pro --count 5 --days 365

# 生成 3 张机构版月卡（每月 3600 分钟即 60 小时）
node scripts/gen-redeem-codes.mjs --plan elite --count 3 --days 30
```

参数：

- `--plan` `pro` / `elite`
- `--count` 1-1000
- `--days` 兑换后给多少天有效期
- `--quota` 自定义月配额（分钟），不传按 plan 默认（pro=1200, elite=3600）
- `--note` 备注（渠道、订单号），方便对账

输出 12 位三段式码（XXXX-XXXX-XXXX，避开易混的 0/O/1/I）。

### 发售流程

1. 用户加你微信付款 → 备注「专业版 / 机构版 + 注册邮箱」
2. 你跑脚本生 1 张码
3. 把码发给用户
4. 用户在工作台 → 升级方案 → 输入码 → 兑换 → 自动升级

### 后台查询

Supabase Dashboard → Table Editor → `redeem_codes`：
- `redeemed_at IS NULL` 是未兑换的库存
- 已兑换的可看 `redeemed_by` 对应用户 ID 与 `note` 渠道

## 开发

```bash
# Web 开发（前端 + Vite 代理）
npm run dev

# Electron 桌面端开发
npm run electron:dev
```

## 构建 macOS 客户端

需要 macOS 系统（electron-builder 的 .dmg 打包平台限制）。

### 准备图标（可选）

```bash
mkdir icon.iconset
for size in 16 32 64 128 256 512 1024; do
  half=$((size/2))
  sips -z $half $half icon.png --out "icon.iconset/icon_${half}x${half}.png"
  sips -z $size $size icon.png --out "icon.iconset/icon_${half}x${half}@2x.png"
done
iconutil -c icns icon.iconset -o build-assets/icon.icns
```

### 构建

```bash
npm run electron:build

# 输出
# release/语文教学工作台-1.0.0-arm64.dmg  （Apple Silicon）
# release/语文教学工作台-1.0.0.dmg         （Intel）
```

或推送 git tag 触发 GitHub Actions 自动构建：

```bash
git tag v1.0.1
git push origin v1.0.1
```

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4
- **桌面**：Electron 41
- **转写**：讯飞「录音文件转写」API
- **AI**：OpenAI 兼容 HTTP API（默认 Kimi `kimi-k2.5`）
- **认证 / 订阅**：Supabase Auth + Postgres + RLS
- **支付**：MVP 阶段用激活码（线下加微信付款 → 后台生码发码）

## 安全

- service_role key 仅在 `scripts/` 中通过环境变量使用，绝不进 `src/` 与 git
- 用户无法直接 UPDATE `user_subscriptions`（004 迁移撤销了权限），所有变更走 SECURITY DEFINER RPC
- 微信 OAuth 严格校验 `state`（CSRF 防护）
- Edge Function 生产环境必须配置 `ALLOWED_ORIGINS` 限制 CORS Origin
