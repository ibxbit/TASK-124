'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Dev vs Production loading:
//   Dev:        FRONTEND_URL env → Vite dev server
//   Production: load bundled frontend/dist/index.html from filesystem
function resolveFrontendBase() {
  if (process.env.FRONTEND_URL) return { mode: 'url', base: process.env.FRONTEND_URL };
  const candidates = [
    path.join(app.getAppPath(), 'frontend', 'dist', 'index.html'),
    path.join(app.getAppPath(), '..', 'frontend', 'dist', 'index.html'),
    path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { mode: 'file', base: c };
  }
  return { mode: 'url', base: 'http://localhost:5173' };
}
let _frontend = null;
function getFrontend() { return _frontend || (_frontend = resolveFrontendBase()); }

const WINDOW_DEFS = {
  queue: { route: '#/queue', title: 'Moderation Queue', width: 1280, height: 900, alwaysOnTop: true },
  lab: { route: '#/lab', title: 'Experiment Lab', width: 1600, height: 1000, alwaysOnTop: false },
  settlement: { route: '#/settlement', title: 'Settlement Workbench', width: 1600, height: 1000, alwaysOnTop: false },
  auditLog: { route: '#/audit', title: 'System Audit Log', width: 1000, height: 800, alwaysOnTop: false }
};

const windows = new Map();

function preloadPath() { return path.join(__dirname, 'preload.js'); }

function createWindow(id) {
  const def = WINDOW_DEFS[id];
  if (!def) throw new Error(`Unknown window id: ${id}`);
  const existing = windows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: def.width, height: def.height, minWidth: 1024, minHeight: 700,
    title: def.title, alwaysOnTop: def.alwaysOnTop, show: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const fe = getFrontend();
  if (fe.mode === 'file') win.loadFile(fe.base, { hash: def.route.replace('#', '') });
  else win.loadURL(fe.base + def.route);
  win.on('close', (e) => {
    if (!win._allowClose) { e.preventDefault(); win.hide(); }
    else windows.delete(id);
  });
  windows.set(id, win);
  return win;
}

function showWindow(id) {
  const win = windows.get(id) || createWindow(id);
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function getWindow(id) { return windows.get(id); }

function allWindows() {
  return Array.from(windows.values()).filter(w => !w.isDestroyed());
}

function destroyAll() {
  for (const win of windows.values()) {
    win._allowClose = true;
    if (!win.isDestroyed()) win.destroy();
  }
  windows.clear();
}

function broadcast(channel, payload) {
  for (const win of allWindows()) win.webContents.send(channel, payload);
}

module.exports = { WINDOW_DEFS, createWindow, showWindow, getWindow, allWindows, destroyAll, broadcast };
