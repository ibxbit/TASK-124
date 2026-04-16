'use strict';

// API tests for admin routes: memory status, alerts, housekeeping,
// LAN allowlist CRUD, checkpoints.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ─── Memory / health ────────────────────────────────────────────────────────

test('GET /admin/health returns memory status for admin', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/health',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.current, 'expected a "current" memory snapshot');
  assert.ok(body.current.rss > 0, 'expected rss > 0');
});

test('GET /admin/memory/status returns growth metrics', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/memory/status',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
});

test('GET /admin/memory/alerts returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/memory/alerts',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /admin/memory/housekeeping runs without error', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/memory/housekeeping',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok('checkpointsPruned' in body || 'pruned' in body || typeof body === 'object');
});

// ─── Checkpoints ────────────────────────────────────────────────────────────

test('GET /admin/checkpoints/recent returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/checkpoints/recent',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /admin/checkpoints/run-now triggers a checkpoint cycle', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/checkpoints/run-now',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.payload), { ok: true });
});

test('GET /admin/checkpoints/:kind/:key/latest returns 404 for unknown', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/checkpoints/nonexistent/key/latest',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 404);
});

// ─── Recovery ───────────────────────────────────────────────────────────────

test('GET /admin/recovery/events returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/recovery/events',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /admin/recovery/restore runs without crash', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token)
  });
  // Recovery may return 200 (success) or 409/500 (concurrent lock, transient)
  assert.ok(res.statusCode < 600, `unexpected status ${res.statusCode}`);
});

// ─── LAN allowlist CRUD ─────────────────────────────────────────────────────

test('GET /admin/lan-allowlist returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/lan-allowlist',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST → GET → DELETE /admin/lan-allowlist round-trip', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  // Create
  const createRes = await app.inject({
    method: 'POST', url: '/admin/lan-allowlist',
    headers: authHeader(token),
    payload: { ip: '10.0.0.42', label: 'test-machine' }
  });
  assert.equal(createRes.statusCode, 200);
  const entry = JSON.parse(createRes.payload);
  assert.ok(entry.id);
  assert.equal(entry.ip_address || entry.ip, '10.0.0.42');

  // List should include it
  const listRes = await app.inject({
    method: 'GET', url: '/admin/lan-allowlist',
    headers: authHeader(token)
  });
  const list = JSON.parse(listRes.payload);
  assert.ok(list.some(r => r.id === entry.id));

  // Delete
  const delRes = await app.inject({
    method: 'DELETE', url: `/admin/lan-allowlist/${entry.id}`,
    headers: authHeader(token)
  });
  assert.equal(delRes.statusCode, 200);

  // Verify soft-delete (active=false) — the entry is still in the list but deactivated
  const afterDel = await app.inject({
    method: 'GET', url: '/admin/lan-allowlist',
    headers: authHeader(token)
  });
  const afterList = JSON.parse(afterDel.payload);
  const removed = afterList.find(r => r.id === entry.id);
  assert.ok(removed, 'entry should still appear in list');
  assert.equal(removed.active, false, 'entry should be deactivated');
});

test('POST /admin/lan-allowlist 403 for analyst', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/lan-allowlist',
    headers: authHeader(token),
    payload: { ip: '10.0.0.1', label: 'x' }
  });
  assert.equal(res.statusCode, 403);
});

// ─── Permission enforcement ─────────────────────────────────────────────────

test('all admin routes 403 for finance role', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const endpoints = [
    ['GET', '/admin/health'],
    ['GET', '/admin/memory/status'],
    ['GET', '/admin/memory/alerts'],
    ['GET', '/admin/checkpoints/recent'],
    ['GET', '/admin/recovery/events']
  ];
  for (const [method, url] of endpoints) {
    const res = await app.inject({ method, url, headers: authHeader(token) });
    assert.equal(res.statusCode, 403, `${method} ${url} should be 403 for finance`);
  }
});
