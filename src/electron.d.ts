interface ElectronAPI {
  platform: string;
  versions: { electron: string; node: string };
  /** 调起系统原生文件选择对话框，返回 { canceled, filePaths } */
  openFileDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  /**
   * 触发系统原生通知（macOS / Windows / Linux）。
   * body 建议 ≤100 字符。
   */
  showNotification: (opts: { title: string; body: string }) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
