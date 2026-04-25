const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  /** 调起系统原生文件选择对话框，返回 { canceled, filePaths } */
  openFileDialog: () => ipcRenderer.invoke('dialog:openAudioFile'),
});
