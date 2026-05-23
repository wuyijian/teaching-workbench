interface ElectronAPI {
  platform: string;
  versions: { electron: string; node: string };
  /** 调起系统原生文件选择对话框，返回 { canceled, filePaths } */
  openFileDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  /**
   * 自动通过微信 PC 版发消息给指定联系人（仅 Windows）。
   * 返回 SendResult（见 src/utils/wechat.ts）。
   */
  sendWechat: (contactName: string, message: string) => Promise<
    | { ok: true }
    | { ok: false; reason: 'no_wechat_running' | 'not_windows' | 'copy_only' | 'error'; message?: string }
  >;
  /**
   * 触发系统原生通知（macOS / Windows / Linux）。
   * body 建议 ≤100 字符。
   */
  showNotification: (opts: { title: string; body: string }) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
