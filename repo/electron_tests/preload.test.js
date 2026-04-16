'use strict';

// ─── Electron: preload.js ───────────────────────────────────────────────────
// Verifies the sandboxed bridge exposed to the renderer under `window.desktop`.
// We load preload.js with a mocked electron module, capture the bridge
// registration, then exercise each API by asserting the right IPC channel /
// method is invoked.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function loadPreload() {
  clearAllCaches();
  const mock = makeMock();
  installElectronMock(mock);
  require('../electron/src/preload');
  return mock;
}

test('preload exposes a `desktop` bridge with expected top-level APIs', () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;
  assert.ok(api);
  assert.equal(typeof api.shortcuts, 'object');
  assert.equal(typeof api.windows, 'object');
  assert.equal(typeof api.clipboard, 'object');
  assert.equal(typeof api.onShortcut, 'function');
});

test('shortcuts.get/set delegate to ipcMain handlers via invoke', async () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;

  // Register fake handlers on ipcMain (since preload uses ipcRenderer.invoke,
  // which in our mock routes straight to ipcMain.handle)
  const electron = require('electron');
  let received = null;
  electron.ipcMain.handle('shortcuts:get', () => ({ globalSearch: 'Ctrl+K' }));
  electron.ipcMain.handle('shortcuts:set', (_e, cfg) => { received = cfg; return true; });

  const config = await api.shortcuts.get();
  assert.deepEqual(config, { globalSearch: 'Ctrl+K' });
  const ok = await api.shortcuts.set({ approveAction: 'Alt+A' });
  assert.equal(ok, true);
  assert.deepEqual(received, { approveAction: 'Alt+A' });
});

test('windows.open delegates to windows:open IPC', async () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;
  let opened = null;
  const electron = require('electron');
  electron.ipcMain.handle('windows:open', (_e, id) => { opened = id; return true; });
  const res = await api.windows.open('settlement');
  assert.equal(res, true);
  assert.equal(opened, 'settlement');
});

test('clipboard.writeText writes through Electron clipboard module', () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;
  api.clipboard.writeText('hello world');
  assert.deepEqual(mock._state.clipboardWrites, ['hello world']);
});

test('onShortcut: subscribes to renderer IPC and returns an unsubscribe function', () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;
  const seen = [];
  const unsub = api.onShortcut('shortcut:approve', (payload) => seen.push(payload));
  assert.equal(typeof unsub, 'function');

  // Simulate a renderer-side dispatch from our mock ipcRenderer
  const listeners = mock._state.ipcRendererListeners.get('shortcut:approve') || [];
  assert.equal(listeners.length, 1);
  listeners[0]({}, { key: 'Ctrl+Enter' });
  assert.deepEqual(seen, [{ key: 'Ctrl+Enter' }]);

  // unsubscribe removes listener
  unsub();
  const remaining = mock._state.ipcRendererListeners.get('shortcut:approve') || [];
  assert.equal(remaining.length, 0);
});

test('onShortcut listeners for distinct channels are independent', () => {
  const mock = loadPreload();
  const api = mock._state.contextBridge.desktop;
  const a = [], b = [];
  api.onShortcut('shortcut:approve', () => a.push(1));
  api.onShortcut('shortcut:export',  () => b.push(1));
  mock._state.ipcRendererListeners.get('shortcut:approve')[0]({});
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, []);
  mock._state.ipcRendererListeners.get('shortcut:export')[0]({});
  assert.deepEqual(b, [1]);
});
