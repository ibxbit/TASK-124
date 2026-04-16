'use strict';

// Moderation service API tests: reports, appeals, queue stats,
// hide/restore, decision log.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

test('GET /reports returns open reports for moderator', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/reports',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('GET /reports 403 for finance (no REPORT_HANDLE)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/reports',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('POST /reports creates a report as any authenticated user', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(token),
    payload: {
      targetType: 'review',
      targetId: 1,
      reason: 'test report'
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
});

test('POST /reports/:id/resolve resolves a report as moderator', async () => {
  const app = await getApp();
  const modToken = await getToken(app, 'moderator');

  // Create a report first
  const cr = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(modToken),
    payload: { targetType: 'review', targetId: 1, reason: 'resolve-test' }
  });
  const report = JSON.parse(cr.payload);

  // Resolve it
  const res = await app.inject({
    method: 'POST', url: `/reports/${report.id}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'no_action' }
  });
  assert.equal(res.statusCode, 200);
});

test('GET /appeals returns array for moderator', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/appeals',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /reviews creates a review bound to an order line item', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const db = getDb();

  // Schema: order_line_items(id VARCHAR(64) PK, order_id, sku, quantity, created_at)
  const oliId = `OLI-MOD-${Date.now()}`;
  const ordId = `ORD-MOD-${Date.now()}`;
  await db.query(
    `INSERT INTO order_line_items (id, order_id, sku, quantity)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [oliId, ordId, 'WIDGET-1', 1]);

  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: oliId,
      orderId: ordId,
      rating: 4,
      body: 'Good product, fast delivery.',
      tags: ['quality'], deviceId: 'test-device'
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  const review = body.review || body;
  assert.ok(review.id);
  assert.equal(review.rating, 4);
});

test('POST /reviews duplicate order line item returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const db = getDb();

  const dupOliId = `OLI-DUP-${Date.now()}`;
  const dupOrdId = `ORD-DUP-${Date.now()}`;
  await db.query(
    `INSERT INTO order_line_items (id, order_id, sku, quantity)
     VALUES ($1, $2, $3, $4)`,
    [dupOliId, dupOrdId, 'WIDGET-D', 1]);
  const payload = {
    orderLineItemId: dupOliId,
    orderId: dupOrdId,
    rating: 5, body: 'Great!', tags: [], deviceId: 'test-device'
  };

  await app.inject({ method: 'POST', url: '/reviews', headers: authHeader(token), payload });
  const dup = await app.inject({ method: 'POST', url: '/reviews', headers: authHeader(token), payload });
  assert.equal(dup.statusCode, 409);
});

test('POST /reviews for nonexistent order line returns 404', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: 'NONEXISTENT-OLI-999',
      orderId: 'ORD-FAKE',
      rating: 5, body: 'no such order', tags: [],
      deviceId: 'test-device'
    }
  });
  assert.equal(res.statusCode, 404);
});
