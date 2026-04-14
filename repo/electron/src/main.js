'use strict';

const { app, Tray, Menu, ipcMain, nativeImage, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');

const http = require('http');
const wm = require('./windowManager');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const { startBackgroundJobs, stopBackgroundJobs, setServiceToken } = require('./backgroundJobs');
const { startBackend, stopBackend } = require('./backendLauncher');

const store = new Store({ name: 'preferences' });
let tray = null;
let isQuiting = false;

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Moderation Queue', click: () => wm.showWindow('queue') },
    { label: 'Experiment Lab', click: () => wm.showWindow('lab') },
    { label: 'Settlement Workbench', click: () => wm.showWindow('settlement') },
    { label: 'System Audit Log', click: () => wm.showWindow('auditLog') },
    { type: 'separator' },
    { label: 'Background Jobs: Running', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuiting = true; app.quit(); } }
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Merchant Console');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => wm.showWindow('queue'));
}

function focusTarget() {
  return BrowserWindow.getFocusedWindow() || wm.getWindow('queue') || wm.showWindow('queue');
}

// Acquire a service token by logging in to the backend as the admin user.
// Retries until the backend is ready (it's forked as a child process).
function acquireServiceToken(retries = 20) {
  const port = Number(process.env.API_PORT) || 3131;
  return new Promise((resolve) => {
    function attempt(n) {
      const body = JSON.stringify({ username: 'admin', password: 'admin' });
      const req = http.request(
        {
          host: '127.0.0.1', port, path: '/auth/login', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const { token } = JSON.parse(data);
              if (token) { setServiceToken(token); resolve(token); return; }
            } catch { }
            if (n > 0) setTimeout(() => attempt(n - 1), 500); else resolve(null);
          });
        }
      );
      req.on('error', () => {
        if (n > 0) setTimeout(() => attempt(n - 1), 500); else resolve(null);
      });
      req.end(body);
    }
    attempt(retries);
  });
}

app.whenReady().then(async () => {
  startBackend();

  wm.createWindow('queue');
  wm.createWindow('lab');
  wm.createWindow('settlement');

  createTray();
  registerShortcuts(store, focusTarget);

  // Acquire auth token before starting background jobs (non-blocking for UI)
  acquireServiceToken().then(() => startBackgroundJobs());

  autoUpdater.checkForUpdatesAndNotify();
  autoUpdater.on('update-available', () => {
    wm.broadcast('update:available', { version: 'New version ready' });
  });
  autoUpdater.on('update-downloaded', () => {
    isQuiting = true;
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('shortcuts:get', () => store.get('shortcuts', {}));
  ipcMain.handle('shortcuts:set', (_e, config) => {
    store.set('shortcuts', config);
    unregisterShortcuts();
    registerShortcuts(store, focusTarget);
    return true;
  });
  ipcMain.handle('windows:open', (_e, id) => { wm.showWindow(id); return true; });
});

app.on('before-quit', () => {
  isQuiting = true;
  stopBackgroundJobs();
  unregisterShortcuts();
  stopBackend();
  wm.destroyAll();
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
