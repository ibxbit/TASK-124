'use strict';

// ─── Electron: windowManager.js ─────────────────────────────────────────────
// Tests for multi-window lifecycle: creating, reusing, hiding-on-close,
// focus, broadcast, and the frontend-base resolver (dev URL vs bundled file).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function freshModule() {
  clearAllCaches();
  const mock = makeMock();
  installElectronMock(mock);
  const wm = require('../electron/src/windowManager');
  return { wm, mock };
}

test('createWindow: builds window for known id with expected dimensions', () => {
  const { wm, mock } = freshModule();
  const win = wm.createWindow('queue');
  assert.ok(win);
  assert.equal(mock._state.windowsCreated.length, 1);
  const opts = mock._state.windowsCreated[0];
  assert.equal(opts.width, 1280);
  assert.equal(opts.height, 900);
  assert.equal(opts.title, 'Moderation Queue');
  assert.equal(opts.alwaysOnTop, true);
  assert.equal(opts.webPreferences.contextIsolation, true);
  assert.equal(opts.webPreferences.nodeIntegration, false);
});

test('createWindow: different window ids have different dimensions & alwaysOnTop', () => {
  const { wm, mock } = freshModule();
  wm.createWindow('lab');
  wm.createWindow('settlement');
  wm.createWindow('auditLog');
  const opts = mock._state.windowsCreated;
  assert.equal(opts[0].alwaysOnTop, false); // lab
  assert.equal(opts[0].width, 1600);
  assert.equal(opts[2].title, 'System Audit Log');
  assert.equal(opts[2].width, 1000);
});

test('createWindow: unknown id throws', () => {
  const { wm } = freshModule();
  assert.throws(() => wm.createWindow('nope'), /Unknown window id/);
});

test('createWindow: returns existing window on second call and focuses it', () => {
  const { wm, mock } = freshModule();
  const w1 = wm.createWindow('queue');
  const w2 = wm.createWindow('queue');
  assert.equal(w1, w2);
  assert.equal(mock._state.windowsCreated.length, 1);
  assert.equal(w1._focused, true);
});

test('createWindow: if existing window is hidden, it is shown again', () => {
  const { wm } = freshModule();
  const w = wm.createWindow('queue');
  w.hide();
  assert.equal(w.isVisible(), false);
  wm.createWindow('queue');
  assert.equal(w.isVisible(), true);
});

test('showWindow: creates window if none exists, then focuses', () => {
  const { wm, mock } = freshModule();
  const w = wm.showWindow('lab');
  assert.equal(mock._state.windowsCreated.length, 1);
  assert.equal(w._focused, true);
});

test('getWindow: returns undefined before createWindow, window after', () => {
  const { wm } = freshModule();
  assert.equal(wm.getWindow('queue'), undefined);
  wm.createWindow('queue');
  assert.ok(wm.getWindow('queue'));
});

test('window close event hides (does not destroy) when _allowClose is false', () => {
  const { wm } = freshModule();
  const w = wm.createWindow('queue');
  const e = w.emitClose();
  assert.equal(e.defaultPrevented, true);
  assert.equal(w.isVisible(), false);
  assert.equal(w.isDestroyed(), false);
});

test('allWindows returns non-destroyed windows only', () => {
  const { wm } = freshModule();
  const a = wm.createWindow('queue');
  const b = wm.createWindow('lab');
  assert.equal(wm.allWindows().length, 2);
  b.destroy();
  assert.deepEqual(wm.allWindows().map(w => w.opts.title), ['Moderation Queue']);
});

test('destroyAll: marks all and clears the registry', () => {
  const { wm } = freshModule();
  const a = wm.createWindow('queue');
  const b = wm.createWindow('lab');
  wm.destroyAll();
  assert.equal(a.isDestroyed(), true);
  assert.equal(b.isDestroyed(), true);
  assert.equal(wm.allWindows().length, 0);
});

test('broadcast: forwards message to every open window via webContents.send', () => {
  const { wm, mock } = freshModule();
  wm.createWindow('queue');
  wm.createWindow('lab');
  wm.broadcast('update:available', { version: 'v2' });
  const sent = mock._state.broadcasts;
  assert.equal(sent.length, 2);
  for (const b of sent) {
    assert.equal(b.channel, 'update:available');
    assert.deepEqual(b.payload, { version: 'v2' });
  }
});

test('broadcast after destroy skips destroyed windows', () => {
  const { wm, mock } = freshModule();
  const a = wm.createWindow('queue');
  wm.createWindow('lab');
  a.destroy();
  wm.broadcast('ping', 1);
  // Only the surviving window should have received the broadcast
  assert.equal(mock._state.broadcasts.length, 1);
});

test('FRONTEND_URL env var selects dev Vite URL loading mode', () => {
  process.env.FRONTEND_URL = 'http://localhost:5173';
  try {
    const { wm } = freshModule();
    const w = wm.createWindow('queue');
    assert.equal(w._loaded.kind, 'url');
    assert.match(w._loaded.url, /http:\/\/localhost:5173#\/queue/);
  } finally {
    delete process.env.FRONTEND_URL;
  }
});

test('window route suffix: each window loads its hash route', () => {
  process.env.FRONTEND_URL = 'http://localhost:5173';
  try {
    const { wm } = freshModule();
    const q = wm.createWindow('queue');
    const l = wm.createWindow('lab');
    const s = wm.createWindow('settlement');
    const a = wm.createWindow('auditLog');
    assert.match(q._loaded.url, /#\/queue$/);
    assert.match(l._loaded.url, /#\/lab$/);
    assert.match(s._loaded.url, /#\/settlement$/);
    assert.match(a._loaded.url, /#\/audit$/);
  } finally {
    delete process.env.FRONTEND_URL;
  }
});

test('WINDOW_DEFS exports all four window definitions', () => {
  const { wm } = freshModule();
  const ids = Object.keys(wm.WINDOW_DEFS);
  assert.deepEqual(ids.sort(), ['auditLog', 'lab', 'queue', 'settlement']);
});
