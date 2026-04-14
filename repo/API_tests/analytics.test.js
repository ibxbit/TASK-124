'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('POST /queries/execute returns rows array and total count', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/queries/execute',
    headers: authHeader(token),
    payload: { filters: {}, pagination: { page: 1, pageSize: 10 } }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body.rows));
  assert.ok('total' in body);
  assert.ok('limit' in body);
  assert.ok('offset' in body);
});

test('POST /queries/saved creates a named query', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const name = `q_${Date.now()}`;
  const res = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { name, definition: { filters: { providers: ['stripe'] } } }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.name, name);
  assert.ok(body.id);
});

test('GET /queries/saved returns array of saved queries', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/queries/saved',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /exports validates format + definition', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/exports',
    headers: authHeader(token),
    payload: { format: 'csv', definition: { filters: { dateFrom: '01/01/2026', dateTo: '01/31/2026' } } }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
  assert.ok(body.status);
});

test('POST /exports without dates returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/exports',
    headers: authHeader(token),
    payload: { format: 'csv', definition: { filters: {} } }
  });
  assert.equal(res.statusCode, 400);
});
