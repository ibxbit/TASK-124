'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('GET /health is public and returns ok status', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, 'ok');
  assert.ok(body.timestamp);
  assert.ok(typeof body.uptime === 'number');
});

test('GET /admin/health requires auth', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/admin/health' });
  assert.equal(res.statusCode, 401);
});

test('GET /admin/health with valid token returns memory status', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/health',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.current);
  assert.ok(body.current.rss > 0);
  assert.ok('thresholds' in body);
});

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
