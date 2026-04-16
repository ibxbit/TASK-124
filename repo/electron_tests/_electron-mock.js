'use strict';

// Minimal `electron` module mock. We pre-populate require.cache so that any
// `require('electron')` inside the desktop shell source returns this stub,
// without needing electron's native bits (which aren't installed in tests).

const path = require('path');
const EventEmitter = require('events');

function makeMock(options = {}) {
  const state = {
    registered: [],   // globalShortcut registrations
    broadcasts: [],   // BrowserWindow webContents.send calls
    windowsCreated: [], // BrowserWindow(opts)
    ipcHandlers: new Map(), // ipcMain.handle registrations
    ipcRendererListeners: new Map(), // ipcRenderer.on registrations
    contextBridge: {}, // contextBridge.exposeInMainWorld
    menusBuilt: [],    // Menu.buildFromTemplate calls
    trayInstances: [], // Tray constructor calls
    appEvents: new EventEmitter(),
    trayEvents: new EventEmitter(),
    safeStorageReturn: options.safeStorageReturn !== false,
    clipboardWrites: []
  };

  class BrowserWindow {
    constructor(opts) {
      state.windowsCreated.push(opts);
      this.opts = opts;
      this._visible = true;
      this._destroyed = false;
      this._focused = false;
      this.webContents = {
        send: (channel, payload) => state.broadcasts.push({ channel, payload })
      };
      this._closeListeners = [];
    }
    isVisible() { return this._visible; }
    isDestroyed() { return this._destroyed; }
    show() { this._visible = true; }
    hide() { this._visible = false; }
    focus() { this._focused = true; }
    destroy() { this._destroyed = true; this._visible = false; }
    loadFile(file, opts) { this._loaded = { kind: 'file', file, opts }; }
    loadURL(url) { this._loaded = { kind: 'url', url }; }
    on(event, cb) {
      if (event === 'close') this._closeListeners.push(cb);
    }
    emitClose() {
      const e = { preventDefault() { this.defaultPrevented = true; } };
      for (const cb of this._closeListeners) cb(e);
      return e;
    }
    static getFocusedWindow() { return null; }
  }

  const app = Object.assign(new EventEmitter(), {
    _ready: false,
    whenReady() { this._ready = true; return Promise.resolve(); },
    getAppPath() { return options.appPath || path.join(__dirname, '..'); },
    getPath(key) { return options.userData || path.join(require('os').tmpdir(), 'merchant-test-' + process.pid); },
    quit() { this._quit = true; this.emit('will-quit'); }
  });

  const globalShortcut = {
    register(accel, cb) { state.registered.push({ accel, cb }); return true; },
    unregisterAll() { state.registered.length = 0; }
  };

  class Tray extends EventEmitter {
    constructor(icon) {
      super();
      state.trayInstances.push(this);
      this._icon = icon;
    }
    setToolTip(t) { this._tip = t; }
    setContextMenu(m) { this._menu = m; }
  }

  const Menu = {
    buildFromTemplate(template) {
      state.menusBuilt.push(template);
      return { template };
    }
  };

  const ipcMain = {
    handle(channel, cb) { state.ipcHandlers.set(channel, cb); },
    removeHandler(channel) { state.ipcHandlers.delete(channel); }
  };

  const ipcRenderer = {
    invoke(channel, ...args) {
      const handler = state.ipcHandlers.get(channel);
      if (!handler) return Promise.reject(new Error('No handler: ' + channel));
      return Promise.resolve(handler({}, ...args));
    },
    on(channel, cb) {
      if (!state.ipcRendererListeners.has(channel)) state.ipcRendererListeners.set(channel, []);
      state.ipcRendererListeners.get(channel).push(cb);
    },
    removeListener(channel, cb) {
      const arr = state.ipcRendererListeners.get(channel);
      if (arr) state.ipcRendererListeners.set(channel, arr.filter(x => x !== cb));
    },
    // Stubs for APIs that electron-updater queries at load time
    send() {},
    sendSync() { return null; },
    sendTo() {},
    sendToHost() {},
    once(channel, cb) { this.on(channel, cb); }
  };

  const contextBridge = {
    exposeInMainWorld(key, api) { state.contextBridge[key] = api; }
  };

  const safeStorage = {
    isEncryptionAvailable: () => state.safeStorageReturn,
    encryptString(s) { return Buffer.from('ENC:' + s); },
    decryptString(b) {
      const s = Buffer.from(b).toString('utf8');
      return s.startsWith('ENC:') ? s.slice(4) : s;
    }
  };

  const clipboard = {
    writeText(t) { state.clipboardWrites.push(t); }
  };

  const nativeImage = {
    createEmpty() { return { isEmpty: () => true }; }
  };

  const mock = {
    app, BrowserWindow, Tray, Menu, ipcMain, ipcRenderer, contextBridge,
    globalShortcut, safeStorage, clipboard, nativeImage,
    _state: state
  };
  return mock;
}

// Inject a fake `electron` package into Node's module resolver graph even if
// the real `electron` isn't installed on disk. We rig the built-in require to
// return our mock as soon as it sees the `electron` specifier.
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;
const FAKE_ELECTRON_PATH = '<fake-electron>';
const FAKE_UPDATER_PATH = '<fake-electron-updater>';
const FAKE_STORE_PATH = '<fake-electron-store>';

function ensureResolverPatched() {
  if (Module._resolveFilename === patchedResolve) return;
  Module._resolveFilename = patchedResolve;
  Module._load = patchedLoad;
}

function patchedResolve(request, parent, ...rest) {
  if (request === 'electron') return FAKE_ELECTRON_PATH;
  if (request === 'electron-updater') return FAKE_UPDATER_PATH;
  if (request === 'electron-store') return FAKE_STORE_PATH;
  return originalResolveFilename.call(Module, request, parent, ...rest);
}

function patchedLoad(request, parent, isMain) {
  if (request === FAKE_ELECTRON_PATH) return require.cache[FAKE_ELECTRON_PATH].exports;
  if (request === FAKE_UPDATER_PATH) return require.cache[FAKE_UPDATER_PATH].exports;
  if (request === FAKE_STORE_PATH) return require.cache[FAKE_STORE_PATH].exports;
  return originalLoad.call(Module, request, parent, isMain);
}

function installElectronMock(mock) {
  ensureResolverPatched();
  // Plant the mock exports into require.cache under synthetic keys so that
  // `require('electron')` (as rewritten by our resolver) returns our stub.
  require.cache[FAKE_ELECTRON_PATH] = {
    exports: mock, loaded: true, children: [], paths: [], id: FAKE_ELECTRON_PATH, filename: FAKE_ELECTRON_PATH
  };

  const UpdaterEmitter = require('events').EventEmitter;
  const autoUpdater = new UpdaterEmitter();
  autoUpdater.checkForUpdatesAndNotify = () => {};
  autoUpdater.quitAndInstall = () => { autoUpdater._quit = true; };
  require.cache[FAKE_UPDATER_PATH] = {
    exports: { autoUpdater },
    loaded: true, children: [], paths: [], id: FAKE_UPDATER_PATH, filename: FAKE_UPDATER_PATH
  };

  // Minimal electron-store stub (the real one has a more complex API, but our
  // shell only uses get/set, which the stub covers)
  class Store {
    constructor(opts = {}) { this._name = opts.name; this._data = new Map(); }
    get(key, dflt) { return this._data.has(key) ? this._data.get(key) : dflt; }
    set(key, value) { this._data.set(key, value); }
    delete(key) { this._data.delete(key); }
    has(key) { return this._data.has(key); }
  }
  require.cache[FAKE_STORE_PATH] = {
    exports: Store, loaded: true, children: [], paths: [], id: FAKE_STORE_PATH, filename: FAKE_STORE_PATH
  };

  return { autoUpdater, Store };
}

function clearAllCaches() {
  for (const key of Object.keys(require.cache)) {
    if (
      key === FAKE_ELECTRON_PATH ||
      key === FAKE_UPDATER_PATH ||
      key === FAKE_STORE_PATH ||
      key.includes(path.sep + 'electron' + path.sep + 'src' + path.sep)
    ) {
      delete require.cache[key];
    }
  }
}

module.exports = { makeMock, installElectronMock, clearAllCaches };
