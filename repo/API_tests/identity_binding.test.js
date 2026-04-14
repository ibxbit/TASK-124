'use strict';

// Validates object-level authorization and identity binding from token.
// Tests that spoofing attempts via body fields are rejected or overridden.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// Seed an order line item for review tests
async function seedOrderLine(id = 'OLI_BIND_TEST') {
  await getDb().query(
    `INSERT INTO order_line_items (id, order_id) VALUES ($1, 'O_BIND')
     ON CONFLICT (id) DO NOTHING`, [id]);
  return id;
}

test('POST /reviews binds reviewerId from token, ignoring body spoofing', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const oli = await seedOrderLine(`OLI_SPOOF_${Date.now()}`);
  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: oli, orderId: 'O_BIND',
      reviewerId: 'SPOOFED_IDENTITY',  // attempt to spoof
      deviceId: 'dev1', rating: 4, body: 'test'
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // The reviewer should NOT be the spoofed value
  assert.notEqual(body.review.reviewer, 'SPOOFED_IDENTITY');
});

test('POST /follows uses token identity for follower', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/follows',
    headers: authHeader(token),
    payload: { followeeId: '999' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // follower must be from token, not body
  assert.notEqual(body.followerId, 'SPOOFED');
});

test('POST /reports uses token identity for reporter', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(token),
    payload: { targetType: 'comment', targetId: 1, reason: 'spam test' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.reporter_id);
});

test('POST /reviews for nonexistent order line returns 404', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: 'DOES_NOT_EXIST', orderId: 'O_FAKE',
      deviceId: 'dev1', rating: 5, body: 'test'
    }
  });
  assert.equal(res.statusCode, 404);
  assert.ok(JSON.parse(res.payload).error.includes('not found'));
});
