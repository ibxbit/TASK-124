'use strict';

// ─── E2E test bootstrap ──────────────────────────────────────────────────────
// Spins up the real Fastify backend via API_tests/helpers.js, wires a `fetch`
// shim onto globalThis that routes through fastify.inject, then loads the
// frontend's real api.js — so every user-flow test exercises the full stack
// (backend routing + real services + Postgres) exactly as the browser would,
// but without a network socket or headless browser.

const path = require('path');
const fs = require('fs');
const os = require('os');
const apiHelpers = require('../API_tests/helpers');

function installInjectedFetch(app) {
  const BASE_PREFIX_PATTERNS = [/^https?:\/\/[^/]+/, /^\/\//];
  globalThis.fetch = async function injectedFetch(urlOrReq, init = {}) {
    let url = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
    for (const rx of BASE_PREFIX_PATTERNS) url = url.replace(rx, '');
    const headers = init.headers || {};
    const res = await app.inject({
      method: init.method || 'GET',
      url,
      headers,
      payload: init.body
    });
    const hdrs = new Map(Object.entries(res.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      statusText: 'Status ' + res.statusCode,
      headers: { get: (k) => hdrs.get(String(k).toLowerCase()) || null },
      text: async () => res.payload ? res.payload.toString('utf8') : '',
      json: async () => {
        const t = res.payload ? res.payload.toString('utf8') : '';
        try { return t ? JSON.parse(t) : null; } catch { return t; }
      },
      blob: async () => ({
        size: res.payload ? res.payload.length : 0,
        text: async () => res.payload ? res.payload.toString('utf8') : ''
      })
    };
  };
}

function createLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null
  };
}

function installLocalStorage() {
  const ls = createLocalStorage();
  Object.defineProperty(global, 'localStorage', { value: ls, writable: true, configurable: true });
  return ls;
}

async function loadFrontendApi() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'),
    'utf8'
  ).replace('import.meta.env.VITE_API_URL', "(globalThis.__TEST_API_URL || '')");
  const tmp = path.join(os.tmpdir(), `e2e-api-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, src);
  const mod = await import('file://' + tmp.replace(/\\/g, '/'));
  return mod;
}

async function setupE2E() {
  const app = await apiHelpers.getApp();
  installInjectedFetch(app);
  installLocalStorage();
  globalThis.__TEST_API_URL = ''; // inject uses relative paths
  const api = await loadFrontendApi();
  // Reset token between tests
  api.setToken(null);
  return { app, api, db: apiHelpers.getDb() };
}

// Probe: is a test Postgres reachable? If not, all E2E tests are skipped so
// `node --test` still exits cleanly in environments without a DB.
async function isDbReachable() {
  const net = require('net');
  const host = process.env.PGHOST || process.env.TEST_PGHOST || 'localhost';
  const port = Number(process.env.PGPORT || process.env.TEST_PGPORT || 5432);
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2000 });
    s.once('connect', () => { s.end(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function teardown() {
  await apiHelpers.closeApp();
}

module.exports = { setupE2E, teardown, apiHelpers, isDbReachable };
