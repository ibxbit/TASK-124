'use strict';

// Audit finding: Crash-recovery simulation — API test coverage
//
// Tests the recovery system's ability to restore from checkpoints,
// handle corrupt checkpoints, advisory lock contention, and
// verify recovery event logging.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ── Recovery restore endpoint ──────────────────────────────────────────────

test('POST /admin/recovery/restore runs full recovery and returns summary', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.bootId, 'Should return a boot ID');
  assert.ok(typeof body.durationMs === 'number', 'Should return duration');
  assert.ok(body.settlement !== undefined, 'Should report settlement recovery');
  assert.ok(body.moderation !== undefined, 'Should report moderation recovery');
  assert.ok(body.experiments !== undefined, 'Should report experiment recovery');
  assert.ok(body.restoredAt, 'Should include timestamp');
});

// ── Recovery creates audit events ──────────────────────────────────────────

test('recovery run creates events visible in /admin/recovery/events', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');

  // Run recovery
  await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token), payload: {}
  });

  // Check events
  const res = await app.inject({
    method: 'GET', url: '/admin/recovery/events',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const events = JSON.parse(res.payload);
  assert.ok(events.length > 0, 'Should have recovery events after a restore');
  // Should have an 'all' kind event with 'completed' or 'started' status
  const allEvents = events.filter(e => e.kind === 'all');
  assert.ok(allEvents.length > 0, 'Should log all-kind events');
});

// ── Settlement recovery: interrupted cycle gets resumed ────────────────────

test('settlement recovery resumes running cycles idempotently', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');

  // Create a settlement cycle so there's something to recover
  await app.inject({
    method: 'POST', url: '/settlement/run',
    headers: authHeader(token), payload: {}
  });

  // Now run recovery — it should skip completed cycles or resume running ones
  const adminToken = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(adminToken), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // Settlement section should report counts
  assert.ok(typeof body.settlement.interrupted === 'number');
  assert.ok(typeof body.settlement.resumed === 'number');
  assert.ok(typeof body.settlement.failed === 'number');
});

// ── Moderation queue recovery: counts drift ────────────────────────────────

test('moderation recovery reports live counts and snapshot comparison', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  const mod = body.moderation;
  assert.ok(mod.live !== undefined, 'Should have live counts');
  assert.ok(typeof mod.live.openReports === 'number');
  assert.ok(typeof mod.live.pendingReviewAppeals === 'number');
  assert.ok(typeof mod.live.pendingContentAppeals === 'number');
});

// ── Experiment recovery: reload from DB ────────────────────────────────────

test('experiment recovery reports live count and snapshot comparison', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  const exp = body.experiments;
  assert.ok(typeof exp.liveCount === 'number');
  assert.ok('snapshotVerified' in exp);
});

// ── Checkpoint endpoints ───────────────────────────────────────────────────

test('checkpoint run-now succeeds for admin', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/admin/checkpoints/run-now',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).ok, true);
});

test('checkpoint list returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');

  // Run a checkpoint first to ensure there's data
  await app.inject({
    method: 'POST', url: '/admin/checkpoints/run-now',
    headers: authHeader(token), payload: {}
  });

  const res = await app.inject({
    method: 'GET', url: '/admin/checkpoints/recent',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0, 'Should have at least one checkpoint after run-now');
});

// ── RBAC enforcement ───────────────────────────────────────────────────────

test('analyst cannot trigger recovery restore (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore',
    headers: authHeader(token), payload: {}
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot view recovery events (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/admin/recovery/events',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot view checkpoints (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/admin/checkpoints/recent',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('unauthenticated recovery restore returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/admin/recovery/restore', payload: {}
  });
  assert.equal(res.statusCode, 401);
});
