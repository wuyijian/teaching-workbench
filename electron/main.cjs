const { app, BrowserWindow, Menu, shell, nativeTheme, session, dialog, ipcMain } = require('electron');
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

  // 允许渲染进程使用麦克风（录音功能）。
  // Electron 默认拒绝所有权限请求，不设置此处理器会导致 getUserMedia
  // 抛出误导性的 "NotFoundError: Requested device not found"。
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true);
    } else {
      callback(false);
    }
  });

  sess.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return null; // 其他权限走默认逻辑
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

// ─── 微信自动发送（仅 Windows，通过 PowerShell + WScript.Shell.SendKeys） ────

/**
 * 生成用于控制微信 Windows 客户端的 PowerShell 脚本。
 * 流程：激活微信窗口 → Ctrl+F 打开搜索 → 输入联系人名 → 回车进入对话 → 粘贴消息 → 回车发送。
 * 需要微信 PC 版已登录并在后台运行。
 */
function buildWechatPs1(contactName, message) {
  // 将消息写入临时文件，避免 SendKeys 转义地狱
  const tmp = path.join(app.getPath('temp'), 'wechat_msg.txt');
  // 转义 PowerShell 字符串中的单引号
  const escapedContact = contactName.replace(/'/g, "''");
  const escapedTmp = tmp.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'

# 把消息写入临时文件（用 Set-Content 写 UTF8-NoBOM）
Set-Content -Path '${escapedTmp}' -Value @'
${message.replace(/'/g, "''")}
'@ -Encoding utf8NoBOM

# 找到微信主进程
$proc = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue
if (-not $proc) { Write-Error 'WeChat not running'; exit 1 }

# 将微信窗口带到前台
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@

$hwnd = $proc.MainWindowHandle
[W32]::ShowWindow($hwnd, 9)  # SW_RESTORE
Start-Sleep -Milliseconds 400
[W32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 600

$shell = New-Object -ComObject 'WScript.Shell'

# Ctrl+F：打开搜索框
$shell.SendKeys('^f')
Start-Sleep -Milliseconds 800

# 清空旧内容并输入联系人名
$shell.SendKeys('^a')
Start-Sleep -Milliseconds 200
$shell.SendKeys('${escapedContact}')
Start-Sleep -Milliseconds 1200

# 回车进入对话
$shell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 1000

# 将消息内容放入剪贴板（用 PowerShell Get-Content 读回）
Get-Content -Path '${escapedTmp}' -Raw | Set-Clipboard
Start-Sleep -Milliseconds 400

# 粘贴并发送
$shell.SendKeys('^v')
Start-Sleep -Milliseconds 500
$shell.SendKeys('{ENTER}')

# 清理临时文件
Remove-Item '${escapedTmp}' -Force -ErrorAction SilentlyContinue
Write-Output 'ok'
`;
}

ipcMain.handle('wechat:send', async (_event, contactName, message) => {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'not_windows', message: '自动发送仅支持 Windows' };
  }
  const { execFile } = require('child_process');
  const os = require('os');

  return new Promise(resolve => {
    try {
      const script = buildWechatPs1(contactName, message);
      const scriptPath = path.join(os.tmpdir(), `wechat_send_${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, script, 'utf8');

      execFile(
        'powershell.exe',
        ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: 20000 },
        (err, stdout, stderr) => {
          fs.unlink(scriptPath, () => {}); // 清理脚本文件
          if (err) {
            const msg = stderr?.trim() || err.message;
            if (msg.includes('WeChat not running')) {
              resolve({ ok: false, reason: 'no_wechat_running' });
            } else {
              resolve({ ok: false, reason: 'error', message: msg });
            }
          } else {
            resolve({ ok: true });
          }
        },
      );
    } catch (e) {
      resolve({ ok: false, reason: 'error', message: String(e) });
    }
  });
});

// 原生文件选择对话框，绕过 macOS 对渲染进程 input[type=file] 的限制
ipcMain.handle('dialog:openAudioFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '音频文件', extensions: ['mp3', 'mp4', 'wav', 'm4a', 'ogg', 'webm', 'flac', 'aac', 'mpeg', 'mpga'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return result; // { canceled: boolean, filePaths: string[] }
});

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
