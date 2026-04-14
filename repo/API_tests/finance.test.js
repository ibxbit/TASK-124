'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ─── Payments ───────────────────────────────────────────────────────────────

test('POST /finance/payments creates a payment with ledger entries', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const ext = `EXT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext, provider: 'wechat_pay', merchantId: 'M1',
      orderId: 'O1', state: 'full', grossAmount: 1000, occurredAt: new Date().toISOString()
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.payment);
  assert.ok(body.fees);
  assert.ok(Array.isArray(body.fees));
  assert.ok(body.fees.length >= 4);

  // Verify ledger entries were created
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE payment_id=$1`, [body.payment.id]);
  assert.ok(rows[0].c >= 2);
});

test('POST /finance/payments duplicate external_id returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const ext = `DUP_${Date.now()}`;
  const payload = {
    externalId: ext, provider: 'bank', merchantId: 'M1',
    orderId: 'O2', state: 'full', grossAmount: 500, occurredAt: new Date().toISOString()
  };
  await app.inject({ method: 'POST', url: '/finance/payments', headers: authHeader(token), payload });
  const res = await app.inject({ method: 'POST', url: '/finance/payments', headers: authHeader(token), payload });
  assert.equal(res.statusCode, 409);
});

test('POST /finance/payments/:id/transition pre_auth → full works', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const ext = `TRANS_${Date.now()}`;
  const cr = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext, provider: 'bank', merchantId: 'M2',
      orderId: 'O3', state: 'pre_auth', grossAmount: 200, occurredAt: new Date().toISOString()
    }
  });
  const pid = JSON.parse(cr.payload).payment.id;
  const res = await app.inject({
    method: 'POST', url: `/finance/payments/${pid}/transition`,
    headers: authHeader(token),
    payload: { toState: 'full' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).to, 'full');
});

test('POST /finance/payments/:id/transition illegal returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const ext = `ILL_${Date.now()}`;
  const cr = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext, provider: 'bank', merchantId: 'M3',
      orderId: 'O4', state: 'full', grossAmount: 100, occurredAt: new Date().toISOString()
    }
  });
  const pid = JSON.parse(cr.payload).payment.id;
  const res = await app.inject({
    method: 'POST', url: `/finance/payments/${pid}/transition`,
    headers: authHeader(token),
    payload: { toState: 'pre_auth' }
  });
  assert.equal(res.statusCode, 409);
});

// ─── Commission ─────────────────────────────────────────────────────────────

test('GET /finance/commission-rates returns at least the default rate', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/finance/commission-rates',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body));
  assert.ok(body.some(r => r.rate === '0.12500'));
});

test('PUT /finance/commission-rates by admin updates rate', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'PUT', url: '/finance/commission-rates',
    headers: authHeader(token),
    payload: { provider: 'test_prov', rate: 0.15 }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).rate, '0.15000');
});

// ─── Settlement ─────────────────────────────────────────────────────────────

test('GET /settlement/cycles returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/settlement/cycles',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

test('POST /settlement/run succeeds (processes last closed week)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  // Should always succeed now — it processes the LAST CLOSED week, not the current one.
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.cycleId);
  assert.ok(body.period);
});

test('POST /settlement/run is idempotent (duplicate returns existing cycle)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res1 = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  const res2 = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  const b1 = JSON.parse(res1.payload);
  const b2 = JSON.parse(res2.payload);
  assert.equal(b1.cycleId, b2.cycleId);
  assert.equal(b2.duplicate, true);
});
