'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('GET /reconciliation/export without dates returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/reconciliation/export?type=summary&format=csv',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 400);
});

test('GET /reconciliation/export with valid dates returns CSV stream', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-type'].includes('text/csv'));
  assert.ok(res.payload.includes('Accounting Period:'));
});

test('GET /reconciliation/export with bad date format returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=bad&to=bad',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 400);
});

test('analyst cannot access reconciliation (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('unauthenticated reconciliation returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
  });
  assert.equal(res.statusCode, 401);
});
