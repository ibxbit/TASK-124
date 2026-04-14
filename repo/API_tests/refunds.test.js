'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

async function createPayment(app, token) {
  const ext = `REF_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(token),
    payload: {
      externalId: ext, provider: 'bank', merchantId: 'MR1',
      orderId: 'OR1', state: 'full', grossAmount: 500,
      occurredAt: new Date().toISOString()
    }
  });
  return JSON.parse(res.payload).payment;
}

test('POST /refunds/issue creates a refund linked to payment', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);
  const res = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 100, reason: 'test refund' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
  assert.equal(body.provider, 'bank');
  assert.ok(['approved', 'pending_review'].includes(body.status));
});

test('POST /refunds/issue over balance returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);
  const res = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 999999 }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.payload).error.includes('exceeds'));
});

test('POST /refunds/issue with provider mismatch returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);
  const res = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 50, provider: 'wechat_pay' }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.payload).error.includes('mismatch'));
});

test('full refund lifecycle: issue → approve → execute', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);

  // Issue
  const issueRes = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 100, reason: 'lifecycle test' }
  });
  const refund = JSON.parse(issueRes.payload);
  const rid = refund.id;

  // If risk-gated, approve it
  if (refund.status === 'pending_review') {
    const appRes = await app.inject({
      method: 'POST', url: `/refunds/${rid}/approve`,
      headers: authHeader(token), payload: { note: 'approved in test' }
    });
    assert.equal(appRes.statusCode, 200);
  }

  // Execute
  const execRes = await app.inject({
    method: 'POST', url: `/refunds/${rid}/execute`,
    headers: authHeader(token), payload: {}
  });
  assert.equal(execRes.statusCode, 200);
  assert.equal(JSON.parse(execRes.payload).status, 'executed');

  // Verify ledger entries
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM ledger_entries
     WHERE memo LIKE $1`, [`refund #${rid}`]);
  assert.equal(rows[0].c, 2);  // debit + credit
});

test('POST /refunds/:id/execute on non-approved refund returns 409', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);
  const issueRes = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 50 }
  });
  const refund = JSON.parse(issueRes.payload);
  // Reject it first
  await app.inject({
    method: 'POST', url: `/refunds/${refund.id}/reject`,
    headers: authHeader(token), payload: { note: 'rejected' }
  });
  // Now try to execute — should fail
  const execRes = await app.inject({
    method: 'POST', url: `/refunds/${refund.id}/execute`,
    headers: authHeader(token), payload: {}
  });
  assert.equal(execRes.statusCode, 409);
});

test('GET /refunds/:id/audit returns immutable audit trail', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const payment = await createPayment(app, token);
  const issueRes = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(token),
    payload: { paymentId: payment.id, amount: 25 }
  });
  const rid = JSON.parse(issueRes.payload).id;
  const res = await app.inject({
    method: 'GET', url: `/refunds/${rid}/audit`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const trail = JSON.parse(res.payload);
  assert.ok(Array.isArray(trail));
  assert.ok(trail.some(e => e.action === 'create'));
});

test('GET /risk-rules returns rules', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/risk-rules',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const rules = JSON.parse(res.payload);
  assert.ok(rules.some(r => r.key === 'max_refunds_per_day_per_provider'));
  assert.ok(rules.some(r => r.key === 'max_refund_rate_7d'));
});
