'use strict';

// ─── E2E: end-to-end refund lifecycle ────────────────────────────────────────
// Mirrors what a finance user does in the Settlement Workbench:
//   1. Login as finance
//   2. Create a payment via POST /finance/payments (precondition)
//   3. Issue a refund via POST /refunds/issue (UI: "Issue" button)
//   4. Execute the approved refund via POST /refunds/:id/execute
//   5. Verify the refund shows up in the list
//
// The entire flow runs through the real Fastify app + Postgres, exercising
// the same HTTP paths the Svelte frontend would hit in a browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupE2E, teardown, isDbReachable } = require('./helpers');

test.after(teardown);
let skipOpts = {};test.before(async () => { if (!(await isDbReachable())) skipOpts = { skip: 'Postgres not reachable' }; });const t = (name, fn) => test(name, (ctx) => { if (skipOpts.skip) return ctx.skip(skipOpts.skip); return fn(ctx); });

async function loginAsFinance() {
  const { api } = await setupE2E();
  await api.login('test_finance', 'pass123');
  return api;
}

async function createPayment(api, overrides = {}) {
  const ext = `E2E_REF_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return api.api.post('/finance/payments', {
    externalId: ext,
    provider: overrides.provider || 'wechat_pay',
    merchantId: overrides.merchantId || 'M1',
    orderId: overrides.orderId || 'ORD-E2E',
    state: 'full',
    grossAmount: overrides.grossAmount || 1000,
    occurredAt: new Date().toISOString()
  });
}

t('E2E: finance user completes full refund lifecycle', async () => {
  const api = await loginAsFinance();

  // Create a payment
  const p = await createPayment(api, { grossAmount: 1500 });
  assert.ok(p.payment.id);

  // Issue a refund — the UI coerces numeric strings with Number()
  const refundPaymentId = String(p.payment.id);
  const refundAmount = '500';
  const refundReason = 'E2E test: customer request';
  const r = await api.api.post('/refunds/issue', {
    paymentId: Number(refundPaymentId),
    amount: Number(refundAmount),
    reason: refundReason
  });
  assert.ok(r.id);
  assert.ok(['approved', 'pending_review', 'pending_approval', 'auto_approved'].includes(r.status),
    `unexpected refund status: ${r.status}`);

  // Execute if approved (pending_review requires approval first)
  if (r.status === 'approved' || r.status === 'auto_approved') {
    const ex = await api.api.post(`/refunds/${r.id}/execute`, {});
    assert.ok(ex);
  }

  // Refund should appear in list
  const refunds = await api.api.get('/refunds');
  assert.ok(Array.isArray(refunds));
  const found = refunds.find((x) => x.id === r.id);
  assert.ok(found, 'issued refund should be retrievable via GET /refunds');
});

t('E2E: refund without auth → 401', async () => {
  const { api } = await setupE2E();
  // Not logged in
  await assert.rejects(
    api.api.post('/refunds/issue', { paymentId: 1, amount: 10, reason: 'x' }),
    /401|403/
  );
});

t('E2E: analyst role cannot issue refunds (403 Forbidden)', async () => {
  const { api } = await setupE2E();
  await api.login('test_analyst', 'pass123');
  await assert.rejects(
    api.api.post('/refunds/issue', { paymentId: 1, amount: 10, reason: 'x' }),
    /403/
  );
});

t('E2E: refund amount exceeding payment is rejected', async () => {
  const api = await loginAsFinance();
  const p = await createPayment(api, { grossAmount: 100 });
  await assert.rejects(
    api.api.post('/refunds/issue', {
      paymentId: p.payment.id, amount: 9999, reason: 'too much'
    }),
    /4\d\d/
  );
});

t('E2E: GET /refunds returns an array for finance role', async () => {
  const api = await loginAsFinance();
  const refunds = await api.api.get('/refunds');
  assert.ok(Array.isArray(refunds));
});
