'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('POST /auth/login with valid admin credentials returns token', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { username: 'test_admin', password: 'pass123' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.token);
  assert.equal(body.user.role, 'admin');
});

test('POST /auth/login with wrong password returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { username: 'test_admin', password: 'wrongpass' }
  });
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.payload);
  assert.ok(body.error);
});

test('POST /auth/login with missing fields returns 400', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { username: 'test_admin' }
  });
  assert.equal(res.statusCode, 400);
});

test('GET /auth/me without token returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/auth/me' });
  assert.equal(res.statusCode, 401);
});

test('GET /auth/me with valid token returns user object', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/auth/me',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).role, 'analyst');
});

test('POST /auth/register as admin creates a new user', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/auth/register',
    headers: authHeader(token),
    payload: { username: `api_user_${Date.now()}`, password: 'pw123', role: 'analyst' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).role, 'analyst');
});

test('POST /auth/register as analyst returns 403', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/auth/register',
    headers: authHeader(token),
    payload: { username: 'blocked', password: 'pw123', role: 'finance' }
  });
  assert.equal(res.statusCode, 403);
});

test('POST /auth/register duplicate username returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/auth/register',
    headers: authHeader(token),
    payload: { username: 'test_admin', password: 'pw', role: 'admin' }
  });
  assert.equal(res.statusCode, 409);
});

test('POST /auth/register with invalid role returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/auth/register',
    headers: authHeader(token),
    payload: { username: 'badrole', password: 'pw', role: 'superadmin' }
  });
  assert.equal(res.statusCode, 400);
});
