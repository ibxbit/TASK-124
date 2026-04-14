'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

async function seedOLI(id, orderId = 'O1') {
  await getDb().query(
    `INSERT INTO order_line_items (id, order_id) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`, [id, orderId]);
}

test('POST /reviews creates a review bound to an order line item', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const oli = `OLI_${Date.now()}`;
  await seedOLI(oli);
  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: oli, orderId: 'O1', reviewerId: 'u1',
      deviceId: 'dev1', rating: 4, tags: ['quality'], body: 'Good item.'
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.review.rating, 4);
  assert.equal(body.review.orderLineItemId, oli);
});

test('POST /reviews duplicate order line item returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const oli = `DOLI_${Date.now()}`;
  await seedOLI(oli, 'O2');
  const payload = {
    orderLineItemId: oli, orderId: 'O2', reviewerId: 'u1',
    deviceId: 'dev1', rating: 5, body: 'Great'
  };
  await app.inject({ method: 'POST', url: '/reviews', headers: authHeader(token), payload });
  const res = await app.inject({ method: 'POST', url: '/reviews', headers: authHeader(token), payload });
  assert.equal(res.statusCode, 409);
});

test('POST /reviews invalid rating returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: `BAD_${Date.now()}`, orderId: 'O3',
      reviewerId: 'u1', deviceId: 'dev1', rating: 99
    }
  });
  assert.equal(res.statusCode, 400);
});

test('POST /reviews/:id/hide + /restore moderation flow', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const oli = `MOD_${Date.now()}`;
  await seedOLI(oli, 'O4');
  const cr = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: oli, orderId: 'O4', reviewerId: 'u1',
      deviceId: 'dev1', rating: 3, body: 'Ok.'
    }
  });
  const rid = JSON.parse(cr.payload).review.id;

  const hideRes = await app.inject({
    method: 'POST', url: `/reviews/${rid}/hide`,
    headers: authHeader(token), payload: { reason: 'spam' }
  });
  assert.equal(hideRes.statusCode, 200);
  assert.equal(JSON.parse(hideRes.payload).status, 'hidden');

  const restoreRes = await app.inject({
    method: 'POST', url: `/reviews/${rid}/restore`,
    headers: authHeader(token), payload: { reason: 'false positive' }
  });
  assert.equal(restoreRes.statusCode, 200);
  assert.equal(JSON.parse(restoreRes.payload).status, 'visible');
});

test('GET /reviews/:id/decisions returns immutable log', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const oli = `DEC_${Date.now()}`;
  await seedOLI(oli, 'O5');
  const cr = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(token),
    payload: {
      orderLineItemId: oli, orderId: 'O5', reviewerId: 'u1',
      deviceId: 'dev1', rating: 2, body: 'Meh.'
    }
  });
  const rid = JSON.parse(cr.payload).review.id;
  await app.inject({
    method: 'POST', url: `/reviews/${rid}/hide`,
    headers: authHeader(token), payload: { reason: 'test' }
  });
  const res = await app.inject({
    method: 'GET', url: `/reviews/${rid}/decisions`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const log = JSON.parse(res.payload);
  assert.ok(log.some(e => e.decision === 'hide'));
});
