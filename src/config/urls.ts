const trim = (s: string) => s.replace(/\/$/, '');

const isElectron = import.meta.env.VITE_ELECTRON === '1';

/**
 * 讯飞转写 API 基路径。
 * - Electron：直连讯飞公网（webSecurity:false + session 补 Origin 头）
 * - 网页：走同域反代 /xfyun-api（需在 Nginx/Vercel 配置反代）
 */
export const xfyunProxyBase = isElectron
  ? 'https://office-api-ist-dx.iflyaisol.com'
  : trim((import.meta.env.VITE_XFYUN_PROXY_BASE as string | undefined)?.trim() || '/xfyun-api');

/**
 * Whisper / OpenAI-compatible 音频转写基路径。
 * Electron 里 settings.apiBaseUrl 可能被历史存档为相对路径，需在调用处统一处理。
 */
export function resolveApiBase(apiBaseUrl: string): string {
  if (isElectron && apiBaseUrl.startsWith('/')) {
    return 'https://api.openai.com/v1';
  }
  return trim(apiBaseUrl);
}
