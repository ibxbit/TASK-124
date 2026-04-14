'use strict';

// Audit finding: Engagement/report appeals — API test coverage
//
// Tests the full report → resolve → appeal → appeal-resolve lifecycle,
// including RBAC enforcement and edge cases.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Report creation ────────────────────────────────────────────────────────

test('any authenticated user can create a content report', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(token),
    payload: { targetType: 'comment', targetId: 1, reason: 'spam' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
  assert.equal(body.status, 'open');
  assert.equal(body.reason, 'spam');
});

test('report creation requires targetType, targetId, and reason (400)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(token),
    payload: { targetType: 'comment' } // missing targetId and reason
  });
  assert.equal(res.statusCode, 400);
});

// ── Report resolution ──────────────────────────────────────────────────────

test('moderator can resolve a report with valid outcome', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  // Create a report
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 999, reason: 'inappropriate' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  // Moderator resolves it
  const modToken = await getToken(app, 'moderator');
  const resolveRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'warn' }
  });
  assert.equal(resolveRes.statusCode, 200);
  assert.equal(JSON.parse(resolveRes.payload).outcome, 'warn');
});

test('resolve with invalid outcome returns 400', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 998, reason: 'test' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'invalid_outcome' }
  });
  assert.equal(res.statusCode, 400);
});

test('resolving already-resolved report returns 404', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 997, reason: 'test' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'no_action' }
  });
  // Second resolve should fail
  const res = await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'remove' }
  });
  assert.equal(res.statusCode, 404);
});

test('analyst cannot resolve reports (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/reports/1/resolve',
    headers: authHeader(token),
    payload: { outcome: 'no_action' }
  });
  assert.equal(res.statusCode, 403);
});

// ── Appeal submission ──────────────────────────────────────────────────────

test('user can submit an appeal on a report', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  // Create and resolve a report
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'comment', targetId: 996, reason: 'test_appeal' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'remove' }
  });

  // Submit appeal
  const appealRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/appeals`,
    headers: authHeader(analystToken),
    payload: { reason: 'I believe this was a mistake' }
  });
  assert.equal(appealRes.statusCode, 200);
  const appeal = JSON.parse(appealRes.payload);
  assert.ok(appeal.id);
  assert.equal(appeal.status, 'pending');
  assert.equal(appeal.report_id, reportId);
});

test('appeal without reason returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/reports/1/appeals',
    headers: authHeader(token),
    payload: {}
  });
  assert.equal(res.statusCode, 400);
});

// ── Appeal resolution ──────────────────────────────────────────────────────

test('moderator can resolve an appeal (upheld)', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 995, reason: 'appeal_test' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'remove' }
  });

  const appealRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/appeals`,
    headers: authHeader(analystToken),
    payload: { reason: 'disagree' }
  });
  const appealId = JSON.parse(appealRes.payload).id;

  const resolveRes = await app.inject({
    method: 'POST', url: `/content-appeals/${appealId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'upheld' }
  });
  assert.equal(resolveRes.statusCode, 200);
});

test('moderator can overturn an appeal', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 994, reason: 'overturn_test' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'remove' }
  });

  const appealRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/appeals`,
    headers: authHeader(analystToken),
    payload: { reason: 'should be restored' }
  });
  const appealId = JSON.parse(appealRes.payload).id;

  const resolveRes = await app.inject({
    method: 'POST', url: `/content-appeals/${appealId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'overturned' }
  });
  assert.equal(resolveRes.statusCode, 200);
});

test('appeal resolve with invalid outcome returns 400', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'review', targetId: 993, reason: 'bad_outcome_test' }
  });
  const reportId = JSON.parse(createRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'warn' }
  });

  const appealRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/appeals`,
    headers: authHeader(analystToken),
    payload: { reason: 'test' }
  });
  const appealId = JSON.parse(appealRes.payload).id;

  const res = await app.inject({
    method: 'POST', url: `/content-appeals/${appealId}/resolve`,
    headers: authHeader(modToken),
    payload: { outcome: 'invalid' }
  });
  assert.equal(res.statusCode, 400);
});

test('finance user cannot resolve appeals (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/content-appeals/1/resolve',
    headers: authHeader(token),
    payload: { outcome: 'upheld' }
  });
  assert.equal(res.statusCode, 403);
});

test('GET /content-appeals requires APPEAL_HANDLE permission', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/content-appeals',
    headers: authHeader(finToken)
  });
  assert.equal(res.statusCode, 403);

  const modToken = await getToken(app, 'moderator');
  const modRes = await app.inject({
    method: 'GET', url: '/content-appeals',
    headers: authHeader(modToken)
  });
  assert.equal(modRes.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(modRes.payload)));
});

test('unauthenticated report creation returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/reports',
    payload: { targetType: 'comment', targetId: 1, reason: 'spam' }
  });
  assert.equal(res.statusCode, 401);
});
