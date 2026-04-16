'use strict';

// Success-path HTTP coverage for endpoints that previously only had 401/403
// assertions in rbac.test.js. Each test seeds real data via the HTTP API (no
// mocks, no direct service calls), hits the route through `app.inject`, and
// asserts both status AND response body shape/content.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ─── GET /exports — analyst lists their own export jobs ─────────────────────

test('GET /exports returns analyst\'s job list with id/status/format fields', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');

  // Seed one job via the API so we exercise the full create → list round-trip.
  // Uses filters that validateExport accepts (MM/DD/YYYY period).
  const created = await app.inject({
    method: 'POST', url: '/exports',
    headers: authHeader(token),
    payload: {
      format: 'csv',
      definition: { filters: { dateFrom: '01/01/2020', dateTo: '12/31/2020' } }
    }
  });
  assert.equal(created.statusCode, 200, `create failed: ${created.payload}`);
  const seededJob = JSON.parse(created.payload);
  assert.ok(seededJob.id, 'seeded job must have an id');

  const res = await app.inject({
    method: 'GET', url: '/exports',
    headers: authHeader(token)
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'].split(';')[0], 'application/json');
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list), 'response must be an array');

  const ours = list.find(j => j.id === seededJob.id);
  assert.ok(ours, 'list must include the job we just created');
  // Strong shape assertions — these are contract fields advertised by the route
  assert.equal(typeof ours.id, 'number');
  assert.equal(ours.format, 'csv');
  assert.ok(['pending', 'running', 'completed', 'failed'].includes(ours.status),
    `unexpected status: ${ours.status}`);
  assert.ok(ours.created_at, 'created_at must be present');
});

test('GET /exports without auth returns 401 with error body', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/exports' });
  assert.equal(res.statusCode, 401);
  // @fastify/jwt returns JSON {statusCode,error,message} on auth failure
  const body = JSON.parse(res.payload);
  assert.ok(body.message || body.error, 'error body must describe the failure');
});

test('GET /exports forbidden for moderator (403 with Forbidden error)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/exports',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.payload);
  assert.match(String(body.error || body.message || ''), /[Ff]orbidden|[Pp]ermission/);
});

// ─── GET /reviews — moderator lists reviews ─────────────────────────────────

test('GET /reviews returns array of reviews (moderator) with id/rating/status fields', async () => {
  const app = await getApp();
  const modToken = await getToken(app, 'moderator');

  // Seed a review via HTTP (no direct service calls).
  // The route requires a matching order_line_items row; we insert one so the
  // review create payload succeeds end-to-end.
  const db = getDb();
  const oli = `OLI-LIST-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ord = `ORD-LIST-${Date.now()}`;
  await db.query(
    `INSERT INTO order_line_items (id, order_id, sku, quantity)
     VALUES ($1, $2, 'WIDGET', 1) ON CONFLICT (id) DO NOTHING`,
    [oli, ord]);

  const createRes = await app.inject({
    method: 'POST', url: '/reviews',
    headers: authHeader(modToken),
    payload: {
      orderLineItemId: oli, orderId: ord, rating: 5,
      tags: ['great'], body: 'excellent widget', deviceId: 'dev-list-test'
    }
  });
  assert.equal(createRes.statusCode, 200, `create failed: ${createRes.payload}`);
  const created = JSON.parse(createRes.payload).review;
  assert.ok(created.id, 'seeded review must have an id');

  // Now list — moderator has CONTENT_MODERATE permission
  const res = await app.inject({
    method: 'GET', url: '/reviews',
    headers: authHeader(modToken)
  });

  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list), 'response must be an array');

  const ours = list.find(r => r.id === created.id);
  assert.ok(ours, 'list must include the review we just created');
  assert.equal(typeof ours.id, 'number');
  assert.equal(ours.rating, 5);
  assert.equal(ours.orderId, ord);
  assert.equal(ours.orderLineItemId, oli);
  assert.ok(['visible', 'hidden'].includes(ours.status), `unexpected status: ${ours.status}`);
  assert.ok(Array.isArray(ours.tags));
  assert.ok(ours.tags.includes('great'));
});

test('GET /reviews?status=visible returns only visible reviews', async () => {
  const app = await getApp();
  const modToken = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/reviews?status=visible&limit=10',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  // Every returned row (if any) must match the filter.
  for (const r of list) assert.equal(r.status, 'visible');
});

// ─── GET /refunds — finance lists refunds ───────────────────────────────────

test('GET /refunds returns created refund with provider/status/amount fields (finance)', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');

  // Create a real payment, then issue a refund against it — both via HTTP.
  const ext = `EXT-LIST-REF-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payRes = await app.inject({
    method: 'POST', url: '/finance/payments',
    headers: authHeader(finToken),
    payload: {
      externalId: ext, provider: 'bank', merchantId: 'M-LIST', orderId: `O-${ext}`,
      state: 'full', grossAmount: 800, occurredAt: new Date().toISOString()
    }
  });
  assert.equal(payRes.statusCode, 200, `payment create failed: ${payRes.payload}`);
  const payment = JSON.parse(payRes.payload).payment;
  assert.ok(payment.id);

  const issueRes = await app.inject({
    method: 'POST', url: '/refunds/issue',
    headers: authHeader(finToken),
    payload: { paymentId: payment.id, amount: 123.45, reason: 'list-path test' }
  });
  assert.equal(issueRes.statusCode, 200, `refund issue failed: ${issueRes.payload}`);
  const refund = JSON.parse(issueRes.payload);
  assert.ok(refund.id);

  // List
  const res = await app.inject({
    method: 'GET', url: '/refunds?limit=200',
    headers: authHeader(finToken)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list), 'refund list must be an array');

  const ours = list.find(r => r.id === refund.id);
  assert.ok(ours, 'list must include the refund we just issued');
  assert.equal(ours.provider, 'bank');
  assert.equal(Number(ours.amount), 123.45);
  assert.equal(ours.reason, 'list-path test');
  assert.ok(['approved', 'pending_review', 'pending'].includes(ours.status));
  assert.equal(ours.payment_id, payment.id);
});

test('GET /refunds?status=approved filters by status', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/refunds?status=approved&limit=50',
    headers: authHeader(finToken)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  for (const r of list) assert.equal(r.status, 'approved');
});

// ─── PUT /risk-rules/:key — admin updates a rule ────────────────────────────

test('PUT /risk-rules/:key updates value and returns new key/value (admin)', async () => {
  const app = await getApp();
  const adminToken = await getToken(app, 'admin');

  // Choose a value that is DIFFERENT from what GET /risk-rules currently returns,
  // so the assertion proves a write actually happened.
  const key = 'max_refund_rate_7d';
  const listBefore = await app.inject({
    method: 'GET', url: '/risk-rules',
    headers: authHeader(adminToken)
  });
  assert.equal(listBefore.statusCode, 200);
  const before = JSON.parse(listBefore.payload).find(r => r.key === key);
  const targetValue = before && Number(before.value) === 0.19 ? 0.21 : 0.19;

  const put = await app.inject({
    method: 'PUT', url: `/risk-rules/${key}`,
    headers: authHeader(adminToken),
    payload: { value: targetValue }
  });
  assert.equal(put.statusCode, 200, `PUT failed: ${put.payload}`);
  const body = JSON.parse(put.payload);
  assert.equal(body.key, key);
  assert.equal(Number(body.value), targetValue);
  assert.ok(body.updated_at, 'updated_at must be returned');

  // Confirm via read-path that the value was actually persisted.
  const listAfter = await app.inject({
    method: 'GET', url: '/risk-rules',
    headers: authHeader(adminToken)
  });
  const after = JSON.parse(listAfter.payload).find(r => r.key === key);
  assert.ok(after, 'rule must exist after PUT');
  assert.equal(Number(after.value), targetValue);

  // Direct DB read for a third confirmation — bypasses any service caching.
  const { rows } = await getDb().query(
    'SELECT value FROM risk_rules WHERE key=$1', [key]);
  assert.equal(Number(rows[0].value), targetValue);
});

test('PUT /risk-rules/:key with non-numeric value returns 400', async () => {
  const app = await getApp();
  const adminToken = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'PUT', url: '/risk-rules/max_refund_rate_7d',
    headers: authHeader(adminToken),
    payload: { value: 'not-a-number' }
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.payload);
  assert.ok(body.error, 'error message expected');
  assert.match(String(body.error), /numeric|number|value/i);
});

test('PUT /risk-rules/:key forbidden for finance role (403)', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'PUT', url: '/risk-rules/max_refund_rate_7d',
    headers: authHeader(finToken),
    payload: { value: 0.5 }
  });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.payload);
  assert.match(String(body.error || body.message || ''), /[Ff]orbidden|[Pp]ermission/);
});
