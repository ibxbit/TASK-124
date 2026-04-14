'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ─── Role enforcement: finance-only endpoints ───────────────────────────────

test('POST /settlement/run by analyst returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('GET /refunds by moderator returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/refunds',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

// ─── Role enforcement: moderator-only endpoints ─────────────────────────────

test('GET /reports by finance returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/reports',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('GET /reviews by analyst returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/reviews',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

// ─── Role enforcement: analyst-only endpoints ───────────────────────────────

test('POST /queries/execute by moderator returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/queries/execute',
    headers: authHeader(token), payload: { filters: {} }
  });
  assert.equal(res.statusCode, 403);
});

// ─── Role enforcement: admin-only endpoints ─────────────────────────────────

test('PUT /finance/commission-rates by finance returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'PUT', url: '/finance/commission-rates',
    headers: authHeader(token), payload: { rate: 0.10 }
  });
  assert.equal(res.statusCode, 403);
});

test('PUT /risk-rules/max_refund_rate_7d by analyst returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'PUT', url: '/risk-rules/max_refund_rate_7d',
    headers: authHeader(token), payload: { value: 0.20 }
  });
  assert.equal(res.statusCode, 403);
});

// ─── Dashboard access shared by all roles ───────────────────────────────────

for (const role of ['admin', 'analyst', 'moderator', 'finance']) {
  test(`GET /experiments accessible by ${role}`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/experiments',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 200);
  });
}

// ─── Unauthenticated ────────────────────────────────────────────────────────

test('GET /experiments without token returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/experiments' });
  assert.equal(res.statusCode, 401);
});
