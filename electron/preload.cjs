const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  /** 调起系统原生文件选择对话框，返回 { canceled, filePaths } */
  openFileDialog: () => ipcRenderer.invoke('dialog:openAudioFile'),
  /**
   * 自动通过微信 PC 版发消息给指定联系人（仅 Windows）。
   * @param contactName 微信里的备注名 / 搜索关键词
   * @param message     要发送的文字内容
   */
  sendWechat: (contactName, message) => ipcRenderer.invoke('wechat:send', contactName, message),
  /**
   * 触发系统原生通知（macOS / Windows / Linux）。
   * @param opts.title 通知标题
   * @param opts.body  通知正文（建议 ≤100 字符）
   */
  showNotification: ({ title, body }) => ipcRenderer.send('show-notification', { title, body }),
});
