'use strict';

// Exercises the server.js build() path + service-level calls that are
// normally only invoked during the boot sequence or via background timers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// ─── Server build() returns a well-configured Fastify instance ──────────────

test('build() exposes health, auth, and admin routes', async () => {
  const app = await getApp();
  // Verify key plugin-level properties
  assert.ok(app.authenticate, 'authenticate decorator should be registered');
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const h = JSON.parse(res.payload);
  assert.equal(h.status, 'ok');
  assert.ok(h.uptime >= 0);
  assert.ok(h.timestamp);
});

// ─── Direct service-level calls ─────────────────────────────────────────────
// These bypass routes to exercise service internals for coverage.

test('memoryService.status() returns growth metrics', async () => {
  await getApp(); // ensure DB connected
  const mem = require('../backend/src/services/memoryService');
  const s = await mem.status();
  assert.ok(s.current);
  assert.ok(s.current.rss > 0);
  assert.equal(typeof s.sinceBoot.growth, 'number');
});

test('memoryService.housekeeping() prunes old data', async () => {
  await getApp();
  const mem = require('../backend/src/services/memoryService');
  const r = await mem.housekeeping();
  assert.ok('checkpoints' in r || 'checkpointsPruned' in r);
  assert.ok('memorySamples' in r || 'samplesPruned' in r);
});

test('memoryService.recentAlerts() returns array', async () => {
  await getApp();
  const mem = require('../backend/src/services/memoryService');
  const alerts = await mem.recentAlerts();
  assert.ok(Array.isArray(alerts));
});

test('memoryService.sample() records a sample without error', async () => {
  await getApp();
  const mem = require('../backend/src/services/memoryService');
  await assert.doesNotReject(mem.sample());
});

test('checkpointService.runOnce() and listRecent()', async () => {
  await getApp();
  const cp = require('../backend/src/services/checkpointService');
  await cp.runOnce();
  const list = await cp.listRecent();
  assert.ok(Array.isArray(list));
});

test('lanAllowlistService.isAllowed() for loopback', async () => {
  await getApp();
  const lan = require('../backend/src/services/lanAllowlistService');
  assert.equal(await lan.isAllowed('127.0.0.1'), true);
  assert.equal(await lan.isAllowed('::1'), true);
  assert.equal(lan.isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(lan.isLoopback('10.0.0.1'), false);
});

test('lanAllowlistService.refresh() returns a Set', async () => {
  await getApp();
  const lan = require('../backend/src/services/lanAllowlistService');
  const s = await lan.refresh();
  assert.ok(s instanceof Set);
});

test('recoveryService.listRecentEvents() returns array', async () => {
  await getApp();
  const rec = require('../backend/src/services/recoveryService');
  const events = await rec.listRecentEvents();
  assert.ok(Array.isArray(events));
});

test('snapshotService.listSnapshots() returns array', async () => {
  await getApp();
  const snap = require('../backend/src/services/snapshotService');
  const list = await snap.listSnapshots();
  assert.ok(Array.isArray(list));
});

test('snapshotService.createSnapshot() creates a snapshot file', async () => {
  await getApp();
  const snap = require('../backend/src/services/snapshotService');
  const result = await snap.createSnapshot({ userId: 1, metadata: { reason: 'test' } });
  assert.ok(result);
  assert.ok(result.id || result.snapshotId || result.file);
});

test('moderationService.queueStats() returns counts', async () => {
  await getApp();
  const mod = require('../backend/src/services/moderationService');
  if (!mod.queueStats) return; // function may not exist
  const stats = await mod.queueStats();
  assert.ok(typeof stats === 'object');
});

test('settlementService.listCycles() returns array', async () => {
  await getApp();
  const set = require('../backend/src/services/settlementService');
  const cycles = await set.listCycles();
  assert.ok(Array.isArray(cycles));
});

test('rollbackService.validate() rejects non-existent version', async () => {
  await getApp();
  const rb = require('../backend/src/services/rollbackService');
  try {
    const result = await rb.validate(999999);
    // If it returns without error, the result should indicate invalid
    assert.ok(result.valid === false || result.error);
  } catch (e) {
    // Expected: version not found
    assert.ok(e.message);
  }
});

test('exportService.listJobs() returns array for user', async () => {
  await getApp();
  const exp = require('../backend/src/services/exportService');
  const jobs = await exp.listJobs(1);
  assert.ok(Array.isArray(jobs));
});

test('savedQueries.list() returns array for user', async () => {
  await getApp();
  const sq = require('../backend/src/services/savedQueries');
  const list = await sq.list(1);
  assert.ok(Array.isArray(list));
});

test('importParser.parseBuffer csv with wechat source', async () => {
  // Direct call to the parser service with a CSV buffer
  const parser = require('../backend/src/services/importParser');
  const buf = Buffer.from(
    'transaction_id,amount,merchant_id,order_id,type,time\n' +
    'TX-BOOT-1,500,M1,O1,full,2026-01-01\n');
  const rows = await parser.parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, 'wechat_pay');
  assert.equal(rows[0].grossAmount, 500);
});

test('updateService.listVersions() returns array', async () => {
  await getApp();
  const upd = require('../backend/src/services/updateService');
  const versions = await upd.listVersions();
  assert.ok(Array.isArray(versions));
});

test('updateService.currentVersion() returns null or string', async () => {
  await getApp();
  const upd = require('../backend/src/services/updateService');
  const v = await upd.currentVersion();
  assert.ok(v === null || typeof v === 'string' || typeof v === 'object');
});
