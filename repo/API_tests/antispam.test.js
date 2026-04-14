'use strict';

// Audit finding: Engagement anti-spam/abuse controls — API test coverage
//
// Tests the anti-spam system at the API level: rate limiting, duplicate
// content blocking, blacklist enforcement, and throttle policy management.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ── Comment creation with anti-spam gate ───────────────────────────────────

test('normal comment creation succeeds', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: {
      body: `Test comment ${Date.now()}`,
      targetType: 'review',
      targetId: 1
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
  assert.equal(body.status, 'visible');
});

// ── Duplicate content detection ────────────────────────────────────────────

test('posting duplicate content within 24h is blocked (409)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const duplicateBody = `Exact duplicate text ${Date.now()}`;

  // First post should succeed
  const res1 = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: { body: duplicateBody, targetType: 'review', targetId: 2 }
  });
  assert.equal(res1.statusCode, 200);

  // Second identical post should be blocked
  const res2 = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: { body: duplicateBody, targetType: 'review', targetId: 2 }
  });
  assert.equal(res2.statusCode, 409);
  assert.ok(JSON.parse(res2.payload).error.includes('duplicate'));
});

// ── Empty comment validation ───────────────────────────────────────────────

test('comment with empty body and no images returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: { body: '', targetType: 'review', targetId: 3 }
  });
  assert.equal(res.statusCode, 400);
});

test('comment without targetType returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: { body: 'needs target' }
  });
  assert.equal(res.statusCode, 400);
});

// ── Blacklist enforcement ──────────────────────────────────────────────────

test('blacklisted user cannot post comments (403)', async () => {
  const app = await getApp();
  const adminToken = await getToken(app, 'admin');

  // Get the analyst user's ID
  const analystToken = await getToken(app, 'analyst');
  const meRes = await app.inject({
    method: 'GET', url: '/auth/me',
    headers: authHeader(analystToken)
  });
  const analystId = String(JSON.parse(meRes.payload).id);

  // Blacklist the analyst
  await app.inject({
    method: 'POST', url: '/admin/blacklists',
    headers: authHeader(adminToken),
    payload: { kind: 'user', value: analystId }
  });

  // Analyst tries to comment — should be blocked
  const res = await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(analystToken),
    payload: {
      body: `Blacklisted comment ${Date.now()}`,
      targetType: 'review',
      targetId: 100
    }
  });
  assert.equal(res.statusCode, 403);
  assert.ok(JSON.parse(res.payload).error.includes('blacklist'));

  // Clean up: remove from blacklist
  const listRes = await app.inject({
    method: 'GET', url: '/admin/blacklists?kind=user',
    headers: authHeader(adminToken)
  });
  const entries = JSON.parse(listRes.payload);
  const entry = entries.find(e => e.value === analystId);
  if (entry) {
    await app.inject({
      method: 'DELETE', url: `/admin/blacklists/${entry.id}`,
      headers: authHeader(adminToken)
    });
  }

  // Clean up: the blacklist check in commentService applies a 'blacklisted_user'
  // spam signal (weight 1000) which would block all future comments for this user.
  const db = getDb();
  await db.query(`DELETE FROM spam_scores WHERE user_id = $1`, [analystId]);
});

// ── Throttle policy management ─────────────────────────────────────────────

test('admin can list throttle policies', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/admin/throttle-policies',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('admin can set a throttle policy', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'PUT', url: '/admin/throttle-policies/comments_per_hour',
    headers: authHeader(token),
    payload: { maxCount: 50, windowSeconds: 3600 }
  });
  assert.equal(res.statusCode, 200);
});

test('analyst cannot manage throttle policies (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'PUT', url: '/admin/throttle-policies/comments_per_hour',
    headers: authHeader(token),
    payload: { maxCount: 50, windowSeconds: 3600 }
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot manage blacklists (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/admin/blacklists',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

// ── Comment thread listing ─────────────────────────────────────────────────

test('GET /comments returns thread for target', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  // Post a comment first
  await app.inject({
    method: 'POST', url: '/comments',
    headers: authHeader(token),
    payload: { body: `Thread test ${Date.now()}`, targetType: 'order', targetId: 50 }
  });

  const res = await app.inject({
    method: 'GET', url: '/comments?targetType=order&targetId=50',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('GET /comments without targetType returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/comments',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 400);
});

// ── Unauthenticated ────────────────────────────────────────────────────────

test('unauthenticated comment creation returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/comments',
    payload: { body: 'anon', targetType: 'review', targetId: 1 }
  });
  assert.equal(res.statusCode, 401);
});
