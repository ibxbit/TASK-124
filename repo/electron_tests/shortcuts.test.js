'use strict';

// ─── Electron: shortcuts.js ─────────────────────────────────────────────────
// Global shortcut registration: default accelerators, user overrides via store,
// window targeting/focus behaviour, and forwarding to renderer via IPC.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function freshModule() {
  clearAllCaches();
  const mock = makeMock();
  installElectronMock(mock);
  const mod = require('../electron/src/shortcuts');
  return { mod, mock };
}

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v)
  };
}

test('registerShortcuts: binds all three default accelerators', () => {
  const { mod, mock } = freshModule();
  const store = fakeStore();
  mod.registerShortcuts(store, () => ({ isVisible: () => true, focus: () => {}, webContents: { send: () => {} }, show: () => {} }));
  const accels = mock._state.registered.map(r => r.accel);
  assert.deepEqual(accels.sort(), ['Ctrl+K', 'Ctrl+Return', 'Ctrl+Shift+E']);
});

test('registerShortcuts: user-configured accelerator overrides default', () => {
  const { mod, mock } = freshModule();
  const store = fakeStore({ shortcuts: { globalSearch: 'Ctrl+F' } });
  mod.registerShortcuts(store, () => ({ isVisible: () => true, focus: () => {}, webContents: { send: () => {} } }));
  const accels = mock._state.registered.map(r => r.accel);
  assert.ok(accels.includes('Ctrl+F'));
  assert.ok(!accels.includes('Ctrl+K')); // replaced
});

test('registerShortcuts: empty-string accelerator is skipped (not bound)', () => {
  const { mod, mock } = freshModule();
  const store = fakeStore({ shortcuts: { approveAction: '' } });
  mod.registerShortcuts(store, () => null);
  const accels = mock._state.registered.map(r => r.accel);
  assert.equal(accels.length, 2); // skipped the empty one
});

test('firing the accelerator forwards to webContents via shortcut channel', () => {
  const { mod, mock } = freshModule();
  const sent = [];
  const fakeWin = {
    isVisible: () => true,
    show: () => {},
    focus: () => {},
    webContents: { send: (ch) => sent.push(ch) }
  };
  mod.registerShortcuts(fakeStore(), () => fakeWin);
  for (const r of mock._state.registered) r.cb();
  assert.deepEqual(sent.sort(), ['shortcut:approve', 'shortcut:export', 'shortcut:global-search']);
});

test('firing the accelerator shows hidden window before forwarding', () => {
  const { mod, mock } = freshModule();
  let shown = 0;
  const fakeWin = {
    _visible: false,
    isVisible() { return this._visible; },
    show() { this._visible = true; shown++; },
    focus: () => {},
    webContents: { send: () => {} }
  };
  mod.registerShortcuts(fakeStore(), () => fakeWin);
  // Trigger first shortcut
  mock._state.registered[0].cb();
  assert.equal(fakeWin._visible, true);
  assert.equal(shown, 1);
});

test('firing the accelerator is a no-op when getTarget returns null', () => {
  const { mod, mock } = freshModule();
  mod.registerShortcuts(fakeStore(), () => null);
  // Should not throw
  for (const r of mock._state.registered) {
    assert.doesNotThrow(() => r.cb());
  }
});

test('getTarget can be a direct value (not a function)', () => {
  const { mod, mock } = freshModule();
  const fakeWin = {
    isVisible: () => true, show: () => {}, focus: () => {},
    webContents: { send: () => {} }
  };
  mod.registerShortcuts(fakeStore(), fakeWin);
  assert.doesNotThrow(() => mock._state.registered[0].cb());
});

test('unregisterShortcuts clears the global registry', () => {
  const { mod, mock } = freshModule();
  mod.registerShortcuts(fakeStore(), () => ({
    isVisible: () => true, show: () => {}, focus: () => {},
    webContents: { send: () => {} }
  }));
  assert.equal(mock._state.registered.length, 3);
  mod.unregisterShortcuts();
  assert.equal(mock._state.registered.length, 0);
});

test('DEFAULTS exports the three canonical keys', () => {
  const { mod } = freshModule();
  assert.deepEqual(Object.keys(mod.DEFAULTS).sort(),
    ['approveAction', 'exportData', 'globalSearch']);
  assert.equal(mod.DEFAULTS.globalSearch, 'Ctrl+K');
  assert.equal(mod.DEFAULTS.approveAction, 'Ctrl+Return');
  assert.equal(mod.DEFAULTS.exportData, 'Ctrl+Shift+E');
});
