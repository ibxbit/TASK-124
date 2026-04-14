'use strict';

// Tests admin/internal endpoint protection (ADMIN_OPS permission)
// and verifies non-admin roles are denied.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

const ADMIN_GET_ENDPOINTS = [
  '/admin/health',
  '/admin/memory/status',
  '/admin/memory/alerts',
  '/admin/checkpoints/recent',
  '/admin/recovery/events',
  '/admin/versions',
  '/admin/updates/current',
  '/admin/lan-allowlist'
];

const ADMIN_POST_ENDPOINTS = [
  '/admin/checkpoints/run-now',
  '/admin/memory/housekeeping',
  '/admin/recovery/restore'
];

// Non-admin roles must be denied on all admin endpoints
for (const role of ['analyst', 'moderator', 'finance']) {
  test(`GET /admin/health as ${role} returns 403`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/admin/health',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 403);
  });

  test(`GET /admin/memory/status as ${role} returns 403`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/admin/memory/status',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 403);
  });

  test(`GET /admin/versions as ${role} returns 403`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/admin/versions',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 403);
  });

  test(`GET /admin/lan-allowlist as ${role} returns 403`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/admin/lan-allowlist',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 403);
  });
}

// Admin is allowed on all admin endpoints
test('admin can access /admin/health', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/health',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
});

test('admin can access /admin/versions', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/versions',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
});

test('admin can manage LAN allowlist', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const addRes = await app.inject({
    method: 'POST', url: '/admin/lan-allowlist',
    headers: authHeader(token),
    payload: { ip: '192.168.1.100', label: 'office-pc-1' }
  });
  assert.equal(addRes.statusCode, 200);
  const added = JSON.parse(addRes.payload);
  assert.ok(added.id);
  assert.equal(added.ip_address, '192.168.1.100');

  const listRes = await app.inject({
    method: 'GET', url: '/admin/lan-allowlist',
    headers: authHeader(token)
  });
  assert.equal(listRes.statusCode, 200);
  assert.ok(JSON.parse(listRes.payload).some(r => r.ip_address === '192.168.1.100'));

  const delRes = await app.inject({
    method: 'DELETE', url: `/admin/lan-allowlist/${added.id}`,
    headers: authHeader(token)
  });
  assert.equal(delRes.statusCode, 200);
});

// Unauthenticated
test('unauthenticated request to /admin/health returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/admin/health' });
  assert.equal(res.statusCode, 401);
});
