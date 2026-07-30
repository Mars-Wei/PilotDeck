'use strict';

// OPC Brain desktop shell — Electron main process (P1 MVP).
//
// Lifecycle: single-instance lock → open a window showing a loading screen →
// start the backend (gateway + UI server) → point the window at the UI server.
// On quit, tear the backend down cleanly.

const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const serverManager = require('./server-manager');

let mainWindow = null;
let backend = null;
const DESKTOP_SESSION_PARTITION = 'persist:opcbrain-desktop-v2';

// Older desktop builds registered the Web UI's PWA service worker in Electron's
// default profile. That worker can outlive an app upgrade and serve an old
// index.html which points at chunks no longer present in the new package,
// leaving route-level pages completely blank. Remove only Chromium's service
// worker data before the profile is opened; localStorage and the rest of the
// user's desktop preferences remain untouched.
function purgeLegacyServiceWorkerData() {
  const userDataDir = app.getPath('userData');
  const desktopPartitionDir = path.join(
    userDataDir,
    'Partitions',
    DESKTOP_SESSION_PARTITION.replace(/^persist:/, ''),
  );
  const cacheDirs = [
    path.join(userDataDir, 'Service Worker'),
    path.join(desktopPartitionDir, 'Service Worker'),
    path.join(desktopPartitionDir, 'Cache'),
    path.join(desktopPartitionDir, 'Code Cache'),
  ];

  for (const cacheDir of cacheDirs) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[desktop] Could not remove legacy web cache at ${cacheDir}:`, err);
    }
  }
}

async function clearDesktopWebCaches(window) {
  const rendererSession = window.webContents.session;
  await rendererSession.clearStorageData({
    storages: ['serviceworkers', 'cachestorage'],
  });
  await rendererSession.clearCache();
}

async function loadDesktopUi(window, url) {
  // clearStorageData cannot stop a service worker that Chromium already has in
  // memory. Load the origin once, unregister it from inside that origin, move
  // away so the controlled document is released, then perform a clean load.
  await clearDesktopWebCaches(window);
  await window.loadURL(url);

  try {
    await window.webContents.executeJavaScript(`
      (async () => {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
        }
        if ('caches' in globalThis) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        }
      })()
    `);
  } catch (err) {
    console.warn('[desktop] Could not unregister a legacy service worker:', err);
  }

  await window.loadURL(LOADING_HTML);
  await clearDesktopWebCaches(window);
  await window.loadURL(url);
}

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
      // Keep the desktop renderer isolated from the legacy default profile.
      // Older releases stored a PWA worker there, which can serve stale HTML
      // before clearStorageData gets a chance to run.
      partition: DESKTOP_SESSION_PARTITION,
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
    if (mainWindow) {
      await loadDesktopUi(mainWindow, backend.url);
    }
  } catch (err) {
    dialog.showErrorBox(
      'OPC Brain — 启动失败',
      `本地服务未能就绪：\n${err && err.message ? err.message : String(err)}`,
    );
    app.quit();
  }
}

// Chromium reads service worker state as its profiles initialise, which can be
// before app.whenReady(). Purge the legacy profile synchronously while Electron
// is still starting, and prevent the desktop shell from creating new workers.
app.commandLine.appendSwitch('disable-features', 'ServiceWorker');
purgeLegacyServiceWorkerData();

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
      createWindow().then(() => mainWindow && loadDesktopUi(mainWindow, backend.url));
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
