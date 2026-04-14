'use strict';

// Audit finding: Reconciliation exports — extended API test coverage
//
// Tests edge cases for reconciliation export: format validation,
// content-disposition headers, row counts, RBAC for all roles,
// and various date range scenarios.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Format validation ──────────────────────────────────────────────────────

test('reconciliation export returns proper Content-Disposition header', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const cd = res.headers['content-disposition'];
  assert.ok(cd, 'Content-Disposition header should be present');
  assert.ok(cd.includes('attachment'), 'Should be an attachment download');
  assert.ok(cd.includes('.csv'), 'Filename should have .csv extension');
});

test('reconciliation export returns X-Row-Count header', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const rowCount = res.headers['x-row-count'];
  assert.ok(rowCount !== undefined, 'X-Row-Count header should be present');
  assert.ok(Number(rowCount) >= 0, 'Row count should be a non-negative number');
});

// ── Date edge cases ────────────────────────────────────────────────────────

test('reversed date range (from > to) returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=12/31/2026&to=01/01/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 400);
});

test('single-day range succeeds', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=06/15/2026&to=06/15/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
});

// ── RBAC for all non-finance roles ─────────────────────────────────────────

test('moderator cannot access reconciliation export (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('admin cannot access reconciliation export (no RECONCILIATION_EXPORT perm)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=12/31/2026',
    headers: authHeader(token)
  });
  // Admin does not have RECONCILIATION_EXPORT permission
  assert.equal(res.statusCode, 403);
});

// ── CSV content validation ─────────────────────────────────────────────────

test('CSV export body contains expected report header fields', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET',
    url: '/reconciliation/export?type=summary&format=csv&from=01/01/2026&to=06/30/2026',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = res.payload;
  assert.ok(body.includes('Accounting Period:'), 'Should contain accounting period header');
});
