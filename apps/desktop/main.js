'use strict';

// OPC Brain desktop shell — Electron main process (P1 MVP).
//
// Lifecycle: single-instance lock → open a window showing a loading screen →
// start the backend (gateway + UI server) → point the window at the UI server.
// On quit, tear the backend down cleanly.

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const serverManager = require('./server-manager');

let mainWindow = null;
let backend = null;

// Inline loading screen shown while the backend boots (a few seconds the first
// time, as the gateway + memory subsystems initialise).
const LOADING_HTML =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
  <style>
    html,body{height:100%;margin:0}
    body{display:flex;align-items:center;justify-content:center;flex-direction:column;
      font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:#0a0a0a;color:#a3a3a3}
    .dot{width:8px;height:8px;border-radius:50%;background:#10b981;
      animation:pulse 1.2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
    h1{font-size:15px;color:#e5e5e5;font-weight:600;margin:14px 0 4px}
  </style></head><body>
    <div class="dot"></div><h1>OPC Brain</h1><div>正在启动本地服务…</div>
  </body></html>`);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'OPC Brain',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Open target=_blank / external links in the system browser, not new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Allow mic/camera (voice) — single local user, loopback origin only.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'mediaKeySystem');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(LOADING_HTML);
}

function handleChildCrash(name, code, signal) {
  if (app.isQuitting) return;
  dialog.showErrorBox(
    'OPC Brain — 后端进程退出',
    `「${name}」进程异常退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）。\n` +
      '应用将关闭。请从终端用 `cd apps/desktop && npm run dev` 重新启动以查看日志。',
  );
  app.quit();
}

async function boot() {
  await createWindow();
  try {
    backend = await serverManager.start(handleChildCrash);
    if (mainWindow) await mainWindow.loadURL(backend.url);
  } catch (err) {
    dialog.showErrorBox(
      'OPC Brain — 启动失败',
      `本地服务未能就绪：\n${err && err.message ? err.message : String(err)}`,
    );
    app.quit();
  }
}

// Single-instance lock: focus the existing window instead of starting a 2nd backend.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0 && backend) {
      createWindow().then(() => mainWindow && mainWindow.loadURL(backend.url));
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async (event) => {
    if (app.isQuitting) return;
    app.isQuitting = true;
    event.preventDefault();
    try {
      await serverManager.stop();
    } finally {
      app.exit(0);
    }
  });
}
