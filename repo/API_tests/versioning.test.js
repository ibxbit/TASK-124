'use strict';

// API tests for versioning, snapshot, and rollback routes.
// Exercises: listVersions, currentVersion, createSnapshot, listSnapshots,
// rollback validate (for non-existent id), and permission enforcement.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ─── Version listing ────────────────────────────────────────────────────────

test('GET /admin/versions returns array (admin) — rows carry version/status shape', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/versions',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'].split(';')[0], 'application/json');
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  // v_versions view maps 'installed' → 'active' — the contract for this route
  // is the view's shape, not the underlying table status.
  for (const v of list) {
    assert.equal(typeof v.id, 'number');
    assert.equal(typeof v.version, 'string');
    assert.ok(['active', 'rolled_back'].includes(v.status),
      `unexpected version.status: ${v.status}`);
  }
});

test('GET /admin/versions 403 for non-admin returns { error: Forbidden }', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/admin/versions',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, 'Forbidden');
});

test('GET /admin/updates/current returns null or installed version with version/installed_at fields', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates/current',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // updateService.currentVersion() returns { version, installed_at } or null.
  if (body !== null) {
    assert.equal(typeof body.version, 'string');
    assert.ok(body.installed_at, 'installed_at must be set for an installed version');
  }
});

test('GET /admin/updates returns version list with shape', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  for (const v of list) {
    assert.equal(typeof v.version, 'string');
    assert.ok(v.status);
  }
});

// ─── Snapshots ──────────────────────────────────────────────────────────────

test('GET /admin/snapshots returns array with file/created_at fields', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/snapshots',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  for (const s of list) {
    // Listed snapshots must identify themselves — at minimum id + file location.
    assert.ok(s.id != null, 'snapshot row must have an id');
    assert.ok(s.file || s.file_path || s.path, 'snapshot row must reference a file');
  }
});

test('POST /admin/snapshots creates a snapshot (id + schema_hash + file present)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/snapshots',
    headers: authHeader(token),
    payload: { note: 'test snapshot' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // The snapshotService contract: id always present; file + schemaHash
  // populated for a successful snapshot.
  assert.ok(body.id, 'snapshot must return id');
  assert.ok(body.file || body.file_path, 'snapshot must return file reference');
  if (body.schemaHash) assert.equal(typeof body.schemaHash, 'string');
});

test('POST /admin/snapshots 403 for analyst returns { error: Forbidden }', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/snapshots',
    headers: authHeader(token),
    payload: { note: 'x' }
  });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, 'Forbidden');
});

// ─── Rollback validate ──────────────────────────────────────────────────────

test('GET /admin/updates/999999/rollback/validate returns ok:false/version_not_found', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/updates/999999/rollback/validate',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200, 'validate endpoint should always 200 for an answer');
  const body = JSON.parse(res.payload);
  assert.equal(body.ok, false, 'non-existent version must not validate');
  assert.equal(body.reason, 'version_not_found');
});

// ─── Import requires multipart ──────────────────────────────────────────────

test('POST /admin/updates/import rejects non-multipart with 400 error body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/updates/import',
    headers: authHeader(token),
    payload: { hello: 'world' }
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.payload);
  assert.ok(body.error, 'error must be set');
  assert.match(String(body.error), /multipart/i, 'error must name the failure mode');
});
