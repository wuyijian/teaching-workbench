# 语文教学工作台

音频转写 + AI 课堂反馈的语文教学辅助工具。

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
- **转写**：讯飞大模型 / OpenAI Whisper
- **AI**：兼容 OpenAI API（支持 Kimi / DeepSeek / GPT 等）
