/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 设为 1 时由 Vite 使用相对 publicPath，供 Electron 打包 */
  readonly VITE_ELECTRON?: '1' | string
  /** 子路径部署时例如 /app/，须带首尾斜杠 */
  readonly VITE_BASE_URL?: string
  /**
   * 讯飞转写 API 的浏览器请求前缀。开发环境为 Vite 代理路径；
   * 生产环境应对齐 Nginx/Edge 上的反代，或改为你自己的同域 BFF
   * @default /xfyun-api
   */
  readonly VITE_XFYUN_PROXY_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** preload.cjs 通过 contextBridge 暴露的 Electron 专属 API */
interface ElectronAPI {
  platform: string
  versions: { electron: string; node: string }
}

interface Window {
  electronAPI?: ElectronAPI
}
