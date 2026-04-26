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
})
