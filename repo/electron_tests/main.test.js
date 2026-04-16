'use strict';

// ─── Electron: main.js smoke / integration tests ────────────────────────────
// We don't fully boot the main process (no real BrowserWindow native), but
// we verify the parts that are testable: tray-menu construction, the
// acquireServiceToken HTTP retry loop, and the IPC handlers registered when
// app.whenReady fires.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function freshMain({ loginResponse = { token: 'SVC-T' }, loginStatus = 200, fail = false, retries = 0 } = {}) {
  clearAllCaches();
  const mock = makeMock();
  installElectronMock(mock);

  // Stub http.request
  const http = require('http');
  const originalRequest = http.request;
  let attempts = 0;
  http.request = (opts, cb) => {
    attempts++;
    const shouldFail = fail || attempts <= retries;
    const res = {
      on(ev, handler) {
        if (ev === 'data') {
          if (!shouldFail) handler(JSON.stringify(loginResponse));
        }
        if (ev === 'end') queueMicrotask(() => handler());
        return this;
      },
      resume() {},
      statusCode: loginStatus
    };
    queueMicrotask(() => cb(res));
    return {
      on(ev, handler) {
        if (ev === 'error' && shouldFail) queueMicrotask(() => handler(new Error('ECONNREFUSED')));
        return this;
      },
      end() {}
    };
  };

  // Stub child_process.fork (used by backendLauncher indirectly)
  const cp = require('child_process');
  const originalFork = cp.fork;
  cp.fork = () => {
    const e = { on() { return e; }, kill() {}, killed: false };
    return e;
  };

  // Stub setInterval/setTimeout to avoid keeping Node alive via the 5/15/60
  // minute background-job timers and the 500 ms retry backoff inside
  // acquireServiceToken(). We capture handlers so tests can inspect them
  // if needed, but never actually fire them.
  const originalSetInterval = global.setInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearInterval = global.clearInterval;
  global.setInterval = () => ({ _fake: true });
  global.setTimeout = (fn) => ({ _fake: true }); // retry backoff is never invoked
  global.clearInterval = (t) => {
    if (t && t._fake) return;
    return originalClearInterval.call(global, t);
  };

  const restore = () => {
    http.request = originalRequest;
    cp.fork = originalFork;
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;
    global.clearInterval = originalClearInterval;
  };
  return { mock, restore, attempts: () => attempts };
}

test('main.js: loading registers whenReady without throwing', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Wait a tick for the whenReady().then() to run
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    // windowManager should have created 3 windows (queue, lab, settlement)
    assert.ok(mock._state.windowsCreated.length >= 3);
  } finally {
    restore();
  }
});

test('main.js: tray is created with a context menu', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Let whenReady().then() and its chained acquireServiceToken.then() run
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    assert.equal(mock._state.trayInstances.length, 1);
    assert.equal(mock._state.menusBuilt.length, 1);
    const menu = mock._state.menusBuilt[0];
    const labels = menu.filter(x => x.label).map(x => x.label);
    // Core entries
    assert.ok(labels.includes('Moderation Queue'));
    assert.ok(labels.includes('Experiment Lab'));
    assert.ok(labels.includes('Settlement Workbench'));
    assert.ok(labels.includes('System Audit Log'));
    assert.ok(labels.includes('Quit'));
  } finally {
    restore();
  }
});

test('main.js: IPC handlers for shortcuts:get / shortcuts:set / windows:open are registered', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Let whenReady().then() and its chained acquireServiceToken.then() run
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const channels = Array.from(mock._state.ipcHandlers.keys()).sort();
    assert.deepEqual(channels, ['shortcuts:get', 'shortcuts:set', 'windows:open']);
  } finally {
    restore();
  }
});

test('main.js: tray click handler invokes the showWindow flow', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Let whenReady().then() and its chained acquireServiceToken.then() run
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const tray = mock._state.trayInstances[0];
    const before = mock._state.windowsCreated.length;
    tray.emit('click');
    // No new window should be created (queue already exists), but focus flows
    const after = mock._state.windowsCreated.length;
    assert.equal(after, before);
  } finally {
    restore();
  }
});

test('main.js: ipc "windows:open" handler triggers wm.showWindow', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Let whenReady().then() and its chained acquireServiceToken.then() run
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const handler = mock._state.ipcHandlers.get('windows:open');
    assert.equal(typeof handler, 'function');
    const before = mock._state.windowsCreated.length;
    const ok = await handler({}, 'auditLog');
    assert.equal(ok, true);
    // auditLog wasn't pre-created; should now exist
    assert.equal(mock._state.windowsCreated.length, before + 1);
  } finally {
    restore();
  }
});

test('main.js: ipc "shortcuts:set" persists config and re-registers shortcuts', async () => {
  const { mock, restore } = freshMain();
  try {
    require('../electron/src/main');
    // Let whenReady().then() and its chained acquireServiceToken.then() run
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const setHandler = mock._state.ipcHandlers.get('shortcuts:set');
    const before = mock._state.registered.length;
    const ok = await setHandler({}, { globalSearch: 'Ctrl+F' });
    assert.equal(ok, true);
    // Re-registration triggers unregisterAll + register, so after the call
    // we expect the same count as before (3 accelerators, with one different).
    assert.equal(mock._state.registered.length, before);
    assert.ok(mock._state.registered.some(r => r.accel === 'Ctrl+F'));
  } finally {
    restore();
  }
});
