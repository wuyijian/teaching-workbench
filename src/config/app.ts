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

/** 根据扩展名推断 MIME 类型，避免 fetch('file://') 返回空 blob.type */
const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
  m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm',
  flac: 'audio/flac', aac: 'audio/aac', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
};

/**
 * Electron 环境：调起系统原生文件选择对话框，返回 File 对象。
 * - 使用 ipcRenderer → dialog.showOpenDialog，完全绕过渲染进程对 input[type=file] 的限制。
 * - 用 fetch('file://...') 读取本地文件内容，webSecurity:false 下可用。
 * 返回 null 表示用户取消或出错（出错时会调 onError）。
 */
export async function pickAudioFileViaElectron(
  onError?: (msg: string) => void,
): Promise<File | null> {
  try {
    const result = await window.electronAPI!.openFileDialog();
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    // macOS 路径已是正斜杠；Windows 反斜杠转换
    const urlPath = filePath.replace(/\\/g, '/');
    const url = urlPath.startsWith('/') ? `file://${urlPath}` : `file:///${urlPath}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const name = urlPath.split('/').pop() || 'audio';
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = blob.type || EXT_MIME[ext] || 'application/octet-stream';
    return new File([blob], name, { type: mimeType });
  } catch (e) {
    onError?.('文件读取失败：' + String(e));
    return null;
  }
}
