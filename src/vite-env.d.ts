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
  /** Supabase 项目 URL，如 https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase 匿名公钥（anon key） */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * 微信开放平台 AppID（网站应用）
   * AppSecret 不要放前端！配置到 Supabase Edge Function Secrets
   */
  readonly VITE_WECHAT_APP_ID?: string
  /** OpenAI 兼容大模型（课堂反馈、Agent、转写后问答等） */
  readonly VITE_LLM_API_KEY?: string
  readonly VITE_LLM_BASE_URL?: string
  readonly VITE_LLM_MODEL?: string
  /** 讯飞转写 */
  readonly VITE_XF_APP_ID?: string
  readonly VITE_XF_ACCESS_KEY_ID?: string
  readonly VITE_XF_ACCESS_KEY_SECRET?: string
  /** 火山引擎豆包大模型录音转写 */
  readonly VITE_VOLCANO_APP_ID?: string
  readonly VITE_VOLCANO_ACCESS_KEY?: string
  readonly VITE_VOLCANO_API_KEY?: string
  readonly VITE_VOLCANO_PROXY_BASE?: string
  /** 管理大盘：仅此邮箱可访问 /admin */
  readonly VITE_ADMIN_EMAIL?: string
  /** Umami 流量统计 Website ID */
  readonly VITE_UMAMI_WEBSITE_ID?: string
  /** Umami 追踪脚本 URL（默认 Umami Cloud） */
  readonly VITE_UMAMI_SCRIPT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** preload.cjs 通过 contextBridge 暴露的 Electron 专属 API */
interface ElectronAPI {
  platform: string
  versions: { electron: string; node: string }
  /** 调起系统原生文件选择对话框 */
  openFileDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
}

interface Window {
  electronAPI?: ElectronAPI
}
