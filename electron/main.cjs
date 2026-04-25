const { app, BrowserWindow, Menu, shell, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';

/**
 * 为所有到外部 LLM / 讯飞接口的请求注入 Origin 头，
 * 防止部分 API 因 null origin 返回 403。
 * 注意：真正解决 Chromium CORS 拦截的方式是 webSecurity: false（见 createWindow）。
 */
function setupApiRequestHeaders(sess) {
  const API_PATTERNS = [
    'https://api.openai.com/*',
    'https://api.moonshot.cn/*',
    'https://api.deepseek.com/*',
    'https://dashscope.aliyuncs.com/*',
    'https://open.bigmodel.cn/*',
    'https://office-api-ist-dx.iflyaisol.com/*',
  ];

  sess.webRequest.onBeforeSendHeaders({ urls: API_PATTERNS }, (details, callback) => {
    details.requestHeaders['Origin'] = 'https://electron-app';
    callback({ requestHeaders: details.requestHeaders });
  });
}

// macOS: 深色模式跟随系统
nativeTheme.themeSource = 'dark';

let mainWindow = null;

function createWindow() {
  const iconPath = path.join(__dirname, '../public/icon.png');
  const winOpt = {
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 桌面端只加载本地 file:// 内容，关闭 Chromium 的 CORS 强制，
      // 使渲染进程可直接 fetch 第三方 LLM / 讯飞接口，彻底消除 Failed to fetch。
      webSecurity: false,
    },
    show: false,
  };
  if (isMac) {
    winOpt.titleBarStyle = 'hiddenInset';
    winOpt.trafficLightPosition = { x: 16, y: 16 };
    winOpt.vibrancy = 'under-window';
    winOpt.visualEffectState = 'active';
  } else {
    winOpt.title = '语文教学工作台';
  }
  if (fs.existsSync(iconPath)) {
    winOpt.icon = iconPath;
  }
  mainWindow = new BrowserWindow(winOpt);

  // 加载页面
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // 开发时打开 DevTools
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 窗口准备好后显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部链接在默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// macOS 应用菜单
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 语文教学工作台' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 语文教学工作台' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 语文教学工作台' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置所有窗口' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setupApiRequestHeaders(session.defaultSession);
  buildMenu();
  createWindow();

  // macOS：点击 Dock 图标重新打开窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 非 macOS：关闭所有窗口时退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
