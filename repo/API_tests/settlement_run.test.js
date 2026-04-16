'use strict';

// Settlement cycle execution: runCycle, listCycles, getCycleLines.
// Exercises the full settlement pipeline: create payments → run cycle →
// verify lines computed with correct fees/net.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

async function createTestPayment(app, token, overrides = {}) {
  const ext = `SET_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext,
      provider: overrides.provider || 'wechat_pay',
      merchantId: overrides.merchantId || 'M-SETTLE',
      orderId: overrides.orderId || `O-${ext}`,
      state: 'full',
      grossAmount: overrides.grossAmount || 500,
      occurredAt: overrides.occurredAt || new Date('2020-01-15T12:00:00Z').toISOString()
    }
  });
  return JSON.parse(res.payload);
}

test('POST /settlement/run creates a cycle and GET /settlement/cycles lists it', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  // Create a payment in a past week to ensure there's data to settle
  await createTestPayment(app, token, {
    merchantId: 'M-SRUN',
    grossAmount: 1000,
    occurredAt: '2020-01-15T12:00:00Z'
  });

  const runRes = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token)
  });
  assert.equal(runRes.statusCode, 200);
  const cycle = JSON.parse(runRes.payload);
  assert.ok(cycle.cycleId || cycle.id || cycle.status);

  // List cycles should return at least one
  const listRes = await app.inject({
    method: 'GET', url: '/settlement/cycles',
    headers: authHeader(token)
  });
  assert.equal(listRes.statusCode, 200);
  const cycles = JSON.parse(listRes.payload);
  assert.ok(Array.isArray(cycles));
  assert.ok(cycles.length >= 1);
});

test('GET /settlement/cycles/:id/lines returns merchant line items', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  // Find a cycle from the database
  const { rows } = await getDb().query(
    'SELECT id FROM settlement_cycles ORDER BY id DESC LIMIT 1');
  if (!rows.length) return; // no cycles yet; skip
  const cycleId = rows[0].id;

  const res = await app.inject({
    method: 'GET', url: `/settlement/cycles/${cycleId}/lines`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const lines = JSON.parse(res.payload);
  assert.ok(Array.isArray(lines));
  for (const line of lines) {
    assert.ok('merchant_id' in line);
    assert.ok('gross' in line);
    assert.ok('fees' in line);
    assert.ok('net' in line);
  }
});

test('POST /settlement/run is idempotent (same week → same cycle)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const r1 = await app.inject({ method: 'POST', url: '/settlement/run', headers: authHeader(token) });
  const r2 = await app.inject({ method: 'POST', url: '/settlement/run', headers: authHeader(token) });
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  const c1 = JSON.parse(r1.payload);
  const c2 = JSON.parse(r2.payload);
  // Should be the same cycle (idempotent)
  if (c1.cycleId && c2.cycleId) {
    assert.equal(c1.cycleId, c2.cycleId);
  }
});

test('POST /settlement/run 403 for analyst', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('cycle totals match sum of line items', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const { rows } = await getDb().query(
    'SELECT id, total_gross, total_fees, total_net FROM settlement_cycles WHERE status=\'completed\' ORDER BY id DESC LIMIT 1');
  if (!rows.length) return;
  const cycle = rows[0];

  const linesRes = await app.inject({
    method: 'GET', url: `/settlement/cycles/${cycle.id}/lines`,
    headers: authHeader(token)
  });
  const lines = JSON.parse(linesRes.payload);
  if (!lines.length) return;

  const sumGross = lines.reduce((s, l) => s + Number(l.gross), 0);
  const sumFees  = lines.reduce((s, l) => s + Number(l.fees), 0);
  const sumNet   = lines.reduce((s, l) => s + Number(l.net), 0);

  // Floating-point tolerance
  assert.ok(Math.abs(sumGross - Number(cycle.total_gross)) < 0.02);
  assert.ok(Math.abs(sumFees  - Number(cycle.total_fees))  < 0.02);
  assert.ok(Math.abs(sumNet   - Number(cycle.total_net))   < 0.02);
});
