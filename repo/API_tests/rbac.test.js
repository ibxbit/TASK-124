'use strict';

// RBAC enforcement tests.
//
// Every denial test asserts BOTH the HTTP status AND the error body shape
// (Forbidden / permission message) so that a regression that returned, say,
// a 403 with a leaked stack trace or a 403 with the wrong code path would
// still be caught. Every allow test asserts the successful response shape
// — not just the status code — so handler regressions are observable.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

function assertForbidden(res, method, url) {
  assert.equal(res.statusCode, 403, `${method} ${url} must be 403`);
  assert.equal(res.headers['content-type'].split(';')[0], 'application/json');
  const body = JSON.parse(res.payload);
  // Our requirePermission middleware responds with { error: 'Forbidden', ... }
  assert.match(String(body.error || body.message || ''), /[Ff]orbidden|[Pp]ermission/,
    `403 body must identify the failure: ${res.payload}`);
  // Body must NOT leak internals (stack traces, DB errors, file paths)
  assert.ok(!/ERROR:.*at\s+\//.test(res.payload), 'denial body must not leak stack');
}

// ─── Role enforcement: finance-only endpoints ───────────────────────────────

test('POST /settlement/run by analyst returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });
  assertForbidden(res, 'POST', '/settlement/run');
});

test('GET /refunds by moderator returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/refunds',
    headers: authHeader(token)
  });
  assertForbidden(res, 'GET', '/refunds');
});

// ─── Role enforcement: moderator-only endpoints ─────────────────────────────

test('GET /reports by finance returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/reports',
    headers: authHeader(token)
  });
  assertForbidden(res, 'GET', '/reports');
});

test('GET /reviews by analyst returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/reviews',
    headers: authHeader(token)
  });
  assertForbidden(res, 'GET', '/reviews');
});

// ─── Role enforcement: analyst-only endpoints ───────────────────────────────

test('POST /queries/execute by moderator returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/queries/execute',
    headers: authHeader(token), payload: { filters: {} }
  });
  assertForbidden(res, 'POST', '/queries/execute');
});

// ─── Role enforcement: admin-only endpoints ─────────────────────────────────

test('PUT /finance/commission-rates by finance returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'PUT', url: '/finance/commission-rates',
    headers: authHeader(token), payload: { rate: 0.10 }
  });
  assertForbidden(res, 'PUT', '/finance/commission-rates');
});

test('PUT /risk-rules/max_refund_rate_7d by analyst returns 403 with Forbidden body', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'PUT', url: '/risk-rules/max_refund_rate_7d',
    headers: authHeader(token), payload: { value: 0.20 }
  });
  assertForbidden(res, 'PUT', '/risk-rules/max_refund_rate_7d');
});

// ─── RBAC denials must be audited ───────────────────────────────────────────

test('RBAC denial writes an audit_log row with status=denied', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const marker = `rbac-audit-${Date.now()}`;
  // A denial on a permission-guarded endpoint — include a marker in URL
  // so we can find the exact audit row below.
  await app.inject({
    method: 'POST', url: `/settlement/run?marker=${marker}`,
    headers: authHeader(token), payload: {}
  });
  // Allow audit log write to complete
  await new Promise(r => setTimeout(r, 100));
  const { rows } = await getDb().query(
    `SELECT status, role, method FROM audit_log
     WHERE resource LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`%marker=${marker}%`]);
  assert.ok(rows.length >= 1, 'audit_log row expected for denied request');
  assert.equal(rows[0].status, 'denied');
  assert.equal(rows[0].role, 'analyst');
  assert.equal(rows[0].method, 'POST');
});

// ─── Dashboard access shared by all roles ───────────────────────────────────

for (const role of ['admin', 'analyst', 'moderator', 'finance']) {
  test(`GET /experiments accessible by ${role} (returns array with id/name shape)`, async () => {
    const app = await getApp();
    const token = await getToken(app, role);
    const res = await app.inject({
      method: 'GET', url: '/experiments',
      headers: authHeader(token)
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'].split(';')[0], 'application/json');
    const list = JSON.parse(res.payload);
    assert.ok(Array.isArray(list), `${role}: response must be an array`);
    // If any experiments exist, the contract fields must be present.
    for (const row of list) {
      assert.equal(typeof row.id, 'number', `${role}: experiment.id must be number`);
      assert.equal(typeof row.name, 'string', `${role}: experiment.name must be string`);
    }
  });
}

// ─── Unauthenticated ────────────────────────────────────────────────────────

test('GET /experiments without token returns 401 with auth error body', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/experiments' });
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.payload);
  // @fastify/jwt returns { statusCode, error, message } describing the failure.
  assert.ok(body.message || body.error, 'auth failure body must describe the error');
  assert.match(String(body.message || body.error || ''),
    /[Aa]uth|[Tt]oken|[Uu]nauthorized|[Mm]issing/);
});
