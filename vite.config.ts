import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Electron 打包时设 VITE_ELECTRON=1 使用相对路径；网页版用 / 或 VITE_BASE_URL
const isElectron = process.env.VITE_ELECTRON === '1'
const base = process.env.VITE_BASE_URL
  || (isElectron ? './' : '/')

const proxy = {
  '/xfyun-api': {
    target: 'https://office-api-ist-dx.iflyaisol.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/xfyun-api/, ''),
  },
  '/openai-api': {
    target: 'https://api.openai.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/openai-api/, ''),
  },
  /** 本地连 Kimi 时用 /moonshot-api/v1，避免浏览器直连 api.moonshot.cn 的 CORS */
  '/moonshot-api': {
    target: 'https://api.moonshot.cn',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/moonshot-api/, ''),
  },
} as const

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { proxy: { ...proxy } },
  // dev 的 proxy 不会自动套用到 preview，导致 npm run preview 时 Failed to fetch
  preview: { proxy: { ...proxy } },
  build: {
    // Vite 8 默认 target = baseline-widely-available（Safari 16+），
    // 老 macOS 用户（Big Sur=Safari 14, Monterey=Safari 15）会因
    // 新 ES 语法直接 SyntaxError 整页白屏。这里下沉到 safari14 兜底。
    // 注意：CSS 端 Tailwind v4 的 oklch() 仍需 Safari 16.4+，那边问题
    // 表现是"配色发黑/对比度异常"，而不是白屏。
    target: ['es2020', 'safari14', 'chrome89', 'firefox89', 'edge89'],
  },
})
