'use strict';

// Audit finding: Update/import/apply/rollback permissions and failure paths
//
// Tests RBAC enforcement on all versioning endpoints, invalid-state
// transitions, rollback validation dry-run, and failure scenarios.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Permission enforcement ─────────────────────────────────────────────────

test('analyst cannot list versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot list versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot list versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('admin can list versions', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('admin can get current version', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates/current',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
});

// ── Import permission enforcement ──────────────────────────────────────────

test('analyst cannot import update packages (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/import',
    headers: authHeader(token),
    payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot import update packages (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/import',
    headers: authHeader(token),
    payload: {}
  });
  assert.equal(res.statusCode, 403);
});

// ── Apply failure paths ────────────────────────────────────────────────────

test('apply nonexistent version returns 404', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/999999/apply',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 404);
});

test('analyst cannot apply versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/1/apply',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

// ── Rollback permission and failure paths ──────────────────────────────────

test('analyst cannot rollback versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/1/rollback',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot rollback versions (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/1/rollback',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('rollback nonexistent version returns error', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/999999/rollback',
    headers: authHeader(token), payload: {}
  });
  // Should be 404 (version_not_found) or 409 (version_not_active)
  assert.ok([404, 409].includes(res.statusCode));
});

// ── Rollback validation dry-run ────────────────────────────────────────────

test('rollback validate for nonexistent version returns ok:false', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates/999999/rollback/validate',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'version_not_found');
});

test('analyst cannot access rollback validate (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates/1/rollback/validate',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

// ── Snapshot endpoints RBAC ────────────────────────────────────────────────

test('admin can list snapshots', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/snapshots',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('analyst cannot list snapshots (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/admin/snapshots',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('admin can create manual snapshot', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/snapshots',
    headers: authHeader(token),
    payload: { note: 'API test snapshot' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
});

// ── Unauthenticated ────────────────────────────────────────────────────────

test('unauthenticated version list returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/admin/updates' });
  assert.equal(res.statusCode, 401);
});

test('unauthenticated rollback returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/1/rollback', payload: {}
  });
  assert.equal(res.statusCode, 401);
});
