'use strict';

// ─── Electron: backendLauncher.js ───────────────────────────────────────────
// Tests per-boot JWT secret generation, idempotent start/stop, and env
// propagation (MERCHANT_DB_KEY from keystore + configured API_PORT/API_HOST).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function freshModule(childProcesses) {
  clearAllCaches();
  installElectronMock(makeMock());

  // Stub child_process.fork
  const cp = require('child_process');
  const originalFork = cp.fork;
  cp.fork = (entry, args, opts) => {
    const child = {
      entry, args, opts, killed: false,
      kill() { this.killed = true; if (this._exit) this._exit(); },
      on(ev, cb) { if (ev === 'exit') this._exit = cb; return this; }
    };
    childProcesses.push(child);
    return child;
  };
  const mod = require('../electron/src/backendLauncher');
  return { mod, restore: () => { cp.fork = originalFork; } };
}

test('startBackend: forks backend/src/server.js with required env vars', () => {
  // Isolate from any API_PORT/API_HOST the outer test runner may have set
  const savedPort = process.env.API_PORT;
  const savedHost = process.env.API_HOST;
  delete process.env.API_PORT;
  delete process.env.API_HOST;
  try {
    const children = [];
    const { mod, restore } = freshModule(children);
    mod.startBackend();
    assert.equal(children.length, 1);
    const c = children[0];
    assert.match(c.entry, /backend[\\/]src[\\/]server\.js$/);
    assert.equal(c.opts.stdio, 'inherit');
    const env = c.opts.env;
    assert.equal(env.MERCHANT_DB_KEY.length, 64);
    assert.match(env.MERCHANT_DB_KEY, /^[0-9a-f]+$/);
    assert.equal(env.JWT_SECRET, mod.getServiceJwtSecret());
    assert.equal(env.API_PORT, '3131');
    assert.equal(env.API_HOST, '127.0.0.1');
    mod.stopBackend();
    restore();
  } finally {
    if (savedPort !== undefined) process.env.API_PORT = savedPort;
    if (savedHost !== undefined) process.env.API_HOST = savedHost;
  }
});

test('startBackend: is idempotent — second call returns existing child', () => {
  const children = [];
  const { mod, restore } = freshModule(children);
  const c1 = mod.startBackend();
  const c2 = mod.startBackend();
  assert.equal(c1, c2);
  assert.equal(children.length, 1);
  mod.stopBackend();
  restore();
});

test('stopBackend: kills child and resets state so start works again', () => {
  const children = [];
  const { mod, restore } = freshModule(children);
  mod.startBackend();
  mod.stopBackend();
  assert.equal(children[0].killed, true);

  // After stop, we should be able to start again and get a new child.
  mod.startBackend();
  assert.equal(children.length, 2);
  mod.stopBackend();
  restore();
});

test('stopBackend: no-op when not started', () => {
  const children = [];
  const { mod, restore } = freshModule(children);
  assert.doesNotThrow(() => mod.stopBackend());
  assert.equal(children.length, 0);
  restore();
});

test('getServiceJwtSecret: falls back to a per-boot random secret', () => {
  delete process.env.JWT_SECRET;
  const children = [];
  const { mod, restore } = freshModule(children);
  const s = mod.getServiceJwtSecret();
  assert.match(s, /^electron-svc-[0-9a-f]+$/);
  assert.ok(s.length > 20);
  restore();
});

test('getServiceJwtSecret: honours JWT_SECRET from env when set', () => {
  process.env.JWT_SECRET = 'prod-shared-secret-20char';
  try {
    const children = [];
    const { mod, restore } = freshModule(children);
    assert.equal(mod.getServiceJwtSecret(), 'prod-shared-secret-20char');
    restore();
  } finally {
    delete process.env.JWT_SECRET;
  }
});

test('API_PORT/API_HOST env vars propagate to backend child', () => {
  process.env.API_PORT = '4242';
  process.env.API_HOST = '0.0.0.0';
  try {
    const children = [];
    const { mod, restore } = freshModule(children);
    mod.startBackend();
    const env = children[0].opts.env;
    assert.equal(env.API_PORT, '4242');
    assert.equal(env.API_HOST, '0.0.0.0');
    mod.stopBackend();
    restore();
  } finally {
    delete process.env.API_PORT;
    delete process.env.API_HOST;
  }
});

test('child exit event clears internal reference so start() spawns anew', () => {
  const children = [];
  const { mod, restore } = freshModule(children);
  mod.startBackend();
  // Simulate an unexpected exit
  children[0]._exit();
  mod.startBackend();
  assert.equal(children.length, 2);
  mod.stopBackend();
  restore();
});
