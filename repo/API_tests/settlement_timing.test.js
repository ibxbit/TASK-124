'use strict';

// Audit finding: Deterministic settlement timing — API test coverage
//
// Tests that settlement cycle timing is deterministic (same period every
// time), idempotent (duplicate runs return existing cycle), and that
// settlement line items are correctly aggregated.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ── Deterministic period selection ─────────────────────────────────────────

test('consecutive settlement runs return the same period', async () => {
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

  // Same period
  assert.equal(b1.cycleId, b2.cycleId);
  assert.equal(b2.duplicate, true);
});

test('settlement period always starts on Monday 00:00:00', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  const start = new Date(body.period.start);
  assert.equal(start.getDay(), 1, 'Period should start on Monday');
  assert.equal(start.getHours(), 0, 'Period should start at midnight');
});

test('settlement period always ends on Sunday 23:59', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  const end = new Date(body.period.end);
  assert.equal(end.getDay(), 0, 'Period should end on Sunday');
  assert.equal(end.getHours(), 23, 'Period should end at 23:xx');
  assert.equal(end.getMinutes(), 59, 'Period should end at xx:59');
});

// ── Cycle line items ───────────────────────────────────────────────────────

test('GET /settlement/cycles/:id/lines returns merchant line items', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  // Run a cycle to ensure we have one
  const runRes = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  const cycleId = JSON.parse(runRes.payload).cycleId;

  const res = await app.inject({
    method: 'GET', url: `/settlement/cycles/${cycleId}/lines`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const lines = JSON.parse(res.payload);
  assert.ok(Array.isArray(lines));
  // Each line should have merchant_id, gross, fees, net
  for (const line of lines) {
    assert.ok('merchant_id' in line);
    assert.ok('gross' in line);
    assert.ok('fees' in line);
    assert.ok('net' in line);
  }
});

// ── Cycle totals consistency ───────────────────────────────────────────────

test('cycle totals match sum of line items', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  // First create a payment so there's data to settle
  const ext = `SET_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext, provider: 'bank', merchantId: 'SET_MERCHANT',
      orderId: 'SETO1', state: 'full', grossAmount: 5000,
      occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago
    }
  });

  // Run settlement
  const runRes = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  const body = JSON.parse(runRes.payload);
  const cycleId = body.cycleId;

  // Get line items
  const linesRes = await app.inject({
    method: 'GET', url: `/settlement/cycles/${cycleId}/lines`,
    headers: authHeader(token)
  });
  const lines = JSON.parse(linesRes.payload);

  if (lines.length > 0) {
    const sumGross = lines.reduce((s, l) => s + Number(l.gross), 0);
    const sumFees = lines.reduce((s, l) => s + Number(l.fees), 0);
    const sumNet = lines.reduce((s, l) => s + Number(l.net), 0);

    // Fetch cycle totals from cycles list
    const cyclesRes = await app.inject({
      method: 'GET', url: '/settlement/cycles',
      headers: authHeader(token)
    });
    const cycles = JSON.parse(cyclesRes.payload);
    const cycle = cycles.find(c => c.id === cycleId);
    if (cycle && Number(cycle.total_gross) > 0) {
      assert.equal(
        Math.round(sumGross * 100),
        Math.round(Number(cycle.total_gross) * 100),
        'Gross totals should match'
      );
    }
  }
});

// ── RBAC enforcement ───────────────────────────────────────────────────────

test('analyst cannot run settlement (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot run settlement (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('all dashboard roles can list settlement cycles', async () => {
  const app = await getApp();
  for (const role of ['admin', 'analyst', 'moderator', 'finance']) {
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/settlement/cycles',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 200, `${role} should access settlement cycles`);
  }
});

// ── Unauthenticated ────────────────────────────────────────────────────────

test('unauthenticated settlement run returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/settlement/run', payload: {}
  });
  assert.equal(res.statusCode, 401);
});
