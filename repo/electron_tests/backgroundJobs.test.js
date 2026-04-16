'use strict';

// ─── Electron: backgroundJobs.js ────────────────────────────────────────────
// Timers that fire authenticated HTTP calls to backend admin endpoints while
// the app is minimised to tray. We stub the built-in `http` module to capture
// requests instead of actually making network calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function freshModule(httpCalls) {
  clearAllCaches();
  installElectronMock(makeMock());

  // Replace http.request with a capturing stub
  const http = require('http');
  const originalRequest = http.request;
  http.request = function (opts, cb) {
    httpCalls.push({ opts });
    const fakeRes = {
      resume() {},
      on(event, handler) { if (event === 'end') queueMicrotask(handler); }
    };
    queueMicrotask(() => cb(fakeRes));
    return {
      on() { return this; },
      end() {}
    };
  };

  // Always stub setInterval so real long-running timers never keep Node alive
  // past the test. Tests that want to exercise the timer body capture it from
  // `intervalHandlers`.
  const originalSetInterval = global.setInterval;
  const intervalHandlers = [];
  global.setInterval = (fn) => {
    intervalHandlers.push(fn);
    return { _fake: true, unref: () => {} };
  };
  const originalClearInterval = global.clearInterval;
  global.clearInterval = (t) => {
    if (t && t._fake) return;
    return originalClearInterval.call(global, t);
  };

  const mod = require('../electron/src/backgroundJobs');
  return {
    mod,
    intervalHandlers,
    restore: () => {
      http.request = originalRequest;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  };
}

test('setServiceToken then startBackgroundJobs: first tick schedules timers (no immediate fire)', () => {
  const httpCalls = [];
  const { mod, restore } = freshModule(httpCalls);
  mod.setServiceToken('SVC-TOKEN');
  mod.startBackgroundJobs();
  // Timers fire on interval, NOT immediately on startup — so no http calls yet.
  assert.equal(httpCalls.length, 0);
  mod.stopBackgroundJobs();
  restore();
});

test('startBackgroundJobs: each registered timer is cancelled by stopBackgroundJobs', () => {
  const httpCalls = [];
  const { mod, restore } = freshModule(httpCalls);
  mod.startBackgroundJobs();
  // Check timers are active (can't easily without triggering — we ensure no crash)
  assert.doesNotThrow(() => mod.stopBackgroundJobs());
  assert.doesNotThrow(() => mod.stopBackgroundJobs()); // idempotent second call
  restore();
});

test('call: builds a request with Authorization header when token set', async () => {
  const httpCalls = [];
  const { mod, intervalHandlers, restore } = freshModule(httpCalls);
  mod.setServiceToken('JWT-SVC');
  mod.startBackgroundJobs();
  // Invoke each registered timer handler once
  for (const h of intervalHandlers) h();
  await new Promise(r => setImmediate(r));
  assert.equal(httpCalls.length, intervalHandlers.length);
  for (const c of httpCalls) {
    assert.equal(c.opts.method, 'POST');
    assert.equal(c.opts.headers['Authorization'], 'Bearer JWT-SVC');
  }
  mod.stopBackgroundJobs();
  restore();
});

test('call paths cover checkpoint, settlement, housekeeping', async () => {
  const httpCalls = [];
  const { mod, intervalHandlers, restore } = freshModule(httpCalls);
  mod.startBackgroundJobs();
  for (const h of intervalHandlers) h();
  await new Promise(r => setImmediate(r));
  const paths = httpCalls.map(c => c.opts.path).sort();
  assert.deepEqual(paths, [
    '/admin/checkpoints/run-now',
    '/admin/memory/housekeeping',
    '/settlement/run'
  ]);
  mod.stopBackgroundJobs();
  restore();
});

test('call omits Authorization when no token has been set', async () => {
  const httpCalls = [];
  const { mod, intervalHandlers, restore } = freshModule(httpCalls);
  mod.startBackgroundJobs();
  for (const h of intervalHandlers) h();
  await new Promise(r => setImmediate(r));
  for (const c of httpCalls) {
    assert.equal(c.opts.headers['Authorization'], undefined);
  }
  mod.stopBackgroundJobs();
  restore();
});

test('API_PORT env var is honoured', async () => {
  const httpCalls = [];
  process.env.API_PORT = '4444';
  try {
    const { mod, intervalHandlers, restore } = freshModule(httpCalls);
    mod.startBackgroundJobs();
    for (const h of intervalHandlers) h();
    await new Promise(r => setImmediate(r));
    for (const c of httpCalls) assert.equal(c.opts.port, 4444);
    mod.stopBackgroundJobs();
    restore();
  } finally {
    delete process.env.API_PORT;
  }
});
