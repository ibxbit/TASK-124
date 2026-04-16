'use strict';

// API tests for saved queries CRUD: create, list, get-by-id, delete,
// permission enforcement, and 404 on missing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('POST /queries/saved creates and GET /queries/saved lists it', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const name = `sq_${Date.now()}`;
  const createRes = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { name, definition: { table: 'payments', filters: [] } }
  });
  assert.equal(createRes.statusCode, 200);
  const created = JSON.parse(createRes.payload);
  assert.ok(created.id);
  assert.equal(created.name, name);

  const listRes = await app.inject({
    method: 'GET', url: '/queries/saved',
    headers: authHeader(token)
  });
  const list = JSON.parse(listRes.payload);
  assert.ok(list.some(q => q.id === created.id));
});

test('GET /queries/saved/:id returns the specific query', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const cr = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { name: `sq_get_${Date.now()}`, definition: { table: 'x' } }
  });
  const { id } = JSON.parse(cr.payload);
  const res = await app.inject({
    method: 'GET', url: `/queries/saved/${id}`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).id, id);
});

test('GET /queries/saved/:id returns 404 for non-existent', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/queries/saved/999999',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 404);
});

test('DELETE /queries/saved/:id removes the query', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const cr = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { name: `sq_del_${Date.now()}`, definition: { table: 'x' } }
  });
  const { id } = JSON.parse(cr.payload);
  const delRes = await app.inject({
    method: 'DELETE', url: `/queries/saved/${id}`,
    headers: authHeader(token)
  });
  assert.equal(delRes.statusCode, 200);
  // Confirm it's gone
  const getRes = await app.inject({
    method: 'GET', url: `/queries/saved/${id}`,
    headers: authHeader(token)
  });
  assert.equal(getRes.statusCode, 404);
});

test('POST /queries/saved with missing name returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { definition: {} }
  });
  assert.equal(res.statusCode, 400);
});

test('POST /queries/saved 403 for finance (no QUERY_SAVE permission)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/queries/saved',
    headers: authHeader(token),
    payload: { name: 'x', definition: {} }
  });
  assert.equal(res.statusCode, 403);
});
