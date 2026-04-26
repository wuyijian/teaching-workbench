# 语文教学工作台

音频转写 + AI 课堂反馈的语文教学辅助工具。

## 仓库结构（简要）


| 路径                     | 说明                                                       |
| ---------------------- | -------------------------------------------------------- |
| `src/config/`          | `app` 运行环境；`platformApi` 从 `VITE_*` 注入大模型与讯飞；`urls` 反代基址 |
| `src/context/`         | `AuthContext`、`SubscriptionContext`（登录与转写配额）             |
| `src/agent/`           | Agent 工具与 `useAgent` 对话循环                                |
| `supabase/migrations/` | 数据库迁移（在 Supabase SQL Editor 或 CLI 中执行）                   |
| `supabase/functions/`  | Edge Functions（如微信回调）                                    |
| `electron/`            | 桌面端主进程与 preload                                          |


**配置约定**：大模型与讯飞凭据只在构建/部署环境变量中设置（见 `.env.example`），用户侧「设置」仅保留课堂反馈 Prompt 等偏好。

## 部署环境变量

复制 `.env.example` 为 `.env` 或直接在托管平台（Vercel 等）配置同名字段：

- **必选（Web 全功能）**：`VITE_LLM_API_KEY`、`VITE_XF_APP_ID`、`VITE_XF_ACCESS_KEY_ID`、`VITE_XF_ACCESS_KEY_SECRET`；网页版大模型需同域反代，默认 `VITE_LLM_BASE_URL=/openai-api/v1`（在网关将 `/openai-api` 转发到目标 API）。
- **可选**：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（登录注册）；`VITE_WECHAT_APP_ID`（微信登录）。

## 开发

```bash
# 启动 Web 开发服务器
npm run dev

# 启动 Electron 开发模式（需要 macOS/Linux）
npm run electron:dev
```

## 构建 macOS 客户端

### 前置条件

- macOS 系统（electron-builder 的 .dmg 打包需要在 macOS 上运行）
- Node.js 18+

### 构建步骤

**1. 准备应用图标**

需要将 `build-assets/icon.svg` 转换为 `build-assets/icon.icns`：

```bash
# 方法一：使用 iconutil（macOS 自带）
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build-assets/icon.icns

# 方法二：跳过图标（electron-builder 会使用默认图标）
```

**2. 构建 .dmg 安装包**

```bash
# 构建（在 macOS 上执行）
npm run electron:build

# 输出目录：release/
# 生成文件：release/语文教学工作台-1.0.0-arm64.dmg  （Apple Silicon）
#           release/语文教学工作台-1.0.0.dmg          （Intel）
```

**3. 快速测试（不打包，直接运行）**

```bash
# 先构建 Web 资源
npm run build

# 以生产模式启动 Electron（不生成 .dmg）
cross-env NODE_ENV=production electron .
```

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4
- **桌面**：Electron 41
- **转写**：讯飞大模型（录音文件转写 API）
- **AI**：OpenAI 兼容 HTTP API（Kimi、DeepSeek 等由 `VITE_LLM_`* 指定）

