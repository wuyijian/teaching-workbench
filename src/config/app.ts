/**
 * 是否为 Electron 桌面端打包（build:electron 时 VITE_ELECTRON=1）。
 * 用于区分：桌面端可直连公网 API（由 main 进程 CORS 拦截器兜底）；
 * 网页版必须走同域反代避免浏览器 CORS 拦截。
 */
export const isElectronTarget = import.meta.env.VITE_ELECTRON === '1';

function webOpenAiBase(): string {
  const root = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  // BASE_URL 为 / 时 root 为空字符串，仍使用 /openai-api/v1
  return root ? `${root}/openai-api/v1` : '/openai-api/v1';
}

/**
 * 首次打开时的默认 API 基址。
 * - Electron：直连 OpenAI（main.cjs 中 session 拦截器注入 CORS 头，不依赖 webSecurity: false）
 * - 网页：同域反代 /openai-api/v1（需在网关配置对应 proxy/rewrite）
 */
export const defaultOpenAiCompatibleBase = isElectronTarget
  ? 'https://api.openai.com/v1'
  : webOpenAiBase();

/** 运行时判断当前是否跑在 Electron 内（preload 注入了 window.electronAPI） */
export const isRunningInElectron = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI;
