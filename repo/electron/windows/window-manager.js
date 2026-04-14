'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WINDOW_DEFS = {
  queue: {
    title: 'MESAC — Merchant Queue',
    page: 'queue.html',
    minWidth: 1280,
    minHeight: 720,
    defaultWidth: 1600,
    defaultHeight: 900,
  },
  'experiment-lab': {
    title: 'MESAC — Experiment Lab',
    page: 'experiment-lab.html',
    minWidth: 1280,
    minHeight: 800,
    defaultWidth: 1680,
    defaultHeight: 960,
  },
  settlement: {
    title: 'MESAC — Settlement Workbench',
    page: 'settlement.html',
    minWidth: 1440,
    minHeight: 900,
    defaultWidth: 1920,
    defaultHeight: 1080,
  },
  splash: {
    title: 'MESAC',
    page: 'splash.html',
    width: 480,
    height: 280,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
  },
};

class WindowManager {
  constructor({ backendPort, isDev }) {
    this.backendPort = backendPort;
    this.isDev = isDev;
    /** @type {Map<string, BrowserWindow>} */
    this.windows = new Map();
    this.splashWin = null;

    // In dev mode serve from Vite dev server; in prod serve built assets
    this.baseUrl = isDev
      ? `http://localhost:5173`
      : `file://${path.join(__dirname, '../../frontend/dist')}`;
  }

  // ── Splash ──────────────────────────────────────────────────────────────────
  async showSplash() {
    const def = WINDOW_DEFS.splash;
    this.splashWin = new BrowserWindow({
      width: def.width,
      height: def.height,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await this.splashWin.loadURL(`${this.baseUrl}/${def.page}`);
  }

  closeSplash() {
    if (this.splashWin && !this.splashWin.isDestroyed()) {
      this.splashWin.close();
      this.splashWin = null;
    }
  }

  // ── Open all windows ────────────────────────────────────────────────────────
  async openAll({ backendPort }) {
    this.backendPort = backendPort;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

    // Open windows in sequence; stagger so they don't pile up
    await this.open('queue');
    this.closeSplash();
    // Experiment Lab and Settlement open in background
    this.open('experiment-lab');
    this.open('settlement');

    // Tile: queue left, settlement right, experiment-lab second monitor if present
    this._tileWindows(sw, sh);
  }

  // ── Open named window ───────────────────────────────────────────────────────
  async open(name) {
    if (this.windows.has(name)) {
      this.focus(name);
      return;
    }

    const def = WINDOW_DEFS[name];
    if (!def) throw new Error(`Unknown window: ${name}`);

    const win = new BrowserWindow({
      title: def.title,
      width: def.defaultWidth ?? def.width,
      height: def.defaultHeight ?? def.height,
      minWidth: def.minWidth,
      minHeight: def.minHeight,
      show: false,
      backgroundColor: '#0d1117',
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,         // needs IPC, not strict sandbox
        spellcheck: false,
        // Pass backend port to renderer via query string (safe — local only)
        additionalArguments: [`--backend-port=${this.backendPort}`],
      },
    });

    win.once('ready-to-show', () => {
      win.show();
      if (this.isDev) win.webContents.openDevTools({ mode: 'detach' });
    });

    win.on('closed', () => {
      this.windows.delete(name);
    });

    const url = this.isDev
      ? `${this.baseUrl}/${def.page}`
      : `file://${path.join(__dirname, '../../frontend/dist', def.page)}`;

    await win.loadURL(url);
    this.windows.set(name, win);
    return win;
  }

  focus(name) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  focusQueue() {
    this.focus('queue');
  }

  // ── Tile strategy ───────────────────────────────────────────────────────────
  _tileWindows(sw, sh) {
    const displays = screen.getAllDisplays();
    const qWin = this.windows.get('queue');
    const sWin = this.windows.get('settlement');
    const eWin = this.windows.get('experiment-lab');

    if (qWin && !qWin.isDestroyed()) {
      qWin.setBounds({ x: 0, y: 0, width: Math.floor(sw * 0.55), height: sh });
    }
    if (sWin && !sWin.isDestroyed()) {
      sWin.setBounds({ x: Math.floor(sw * 0.55), y: 0, width: Math.floor(sw * 0.45), height: sh });
    }
    // Experiment Lab: second display if available, else minimised
    if (eWin && !eWin.isDestroyed()) {
      if (displays.length > 1) {
        const d2 = displays[1];
        eWin.setBounds({
          x: d2.workArea.x,
          y: d2.workArea.y,
          width: d2.workArea.width,
          height: d2.workArea.height,
        });
      } else {
        eWin.minimize();
      }
    }
  }

  // ── State capture (for checkpoint) ─────────────────────────────────────────
  captureState() {
    const state = {};
    for (const [name, win] of this.windows) {
      if (!win.isDestroyed()) {
        state[name] = { bounds: win.getBounds(), isMinimized: win.isMinimized() };
      }
    }
    return state;
  }

  // ── Broadcast ───────────────────────────────────────────────────────────────
  broadcastMemoryStats(stats) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('memory:stats', stats);
      }
    }
  }

  broadcast(channel, payload) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}

module.exports = WindowManager;
