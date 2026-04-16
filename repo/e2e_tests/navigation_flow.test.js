'use strict';

// ─── E2E: full user navigation flow ──────────────────────────────────────────
// Simulates the login-then-navigate experience across all three windows:
// Queue, Experiment Lab, Settlement Workbench. Each "navigation" reads data
// the corresponding window would show on mount.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupE2E, teardown, isDbReachable } = require('./helpers');

test.after(teardown);
let skipOpts = {};test.before(async () => { if (!(await isDbReachable())) skipOpts = { skip: 'Postgres not reachable' }; });const t = (name, fn) => test(name, (ctx) => { if (skipOpts.skip) return ctx.skip(skipOpts.skip); return fn(ctx); });

t('E2E: admin navigates experiment-lab + settlement (admin lacks REPORT_HANDLE)', async () => {
  const { api } = await setupE2E();
  const user = await api.login('test_admin', 'pass123');
  assert.equal(user.role, 'admin');

  // Admin does NOT have REPORT_HANDLE — /reports should 403
  await assert.rejects(api.api.get('/reports'), /403/);

  // Experiment Lab loads experiments list (admin has access)
  const experiments = await api.api.get('/experiments');
  assert.ok(Array.isArray(experiments));

  // Settlement Workbench loads cycles + refunds (dashboard_access not needed for admin,
  // but admin has REFUND_ISSUE which grants /refunds; /settlement/cycles needs DASHBOARD_ACCESS)
  const cycles = await api.api.get('/settlement/cycles');
  assert.ok(Array.isArray(cycles));
  const refunds = await api.api.get('/refunds');
  assert.ok(Array.isArray(refunds));
});

t('E2E: finance user reads settlement cycles + refunds on navigation', async () => {
  const { api } = await setupE2E();
  await api.login('test_finance', 'pass123');
  const cycles = await api.api.get('/settlement/cycles');
  const refunds = await api.api.get('/refunds');
  assert.ok(Array.isArray(cycles));
  assert.ok(Array.isArray(refunds));
});

t('E2E: moderator user reads reports + appeals on queue navigation', async () => {
  const { api } = await setupE2E();
  await api.login('test_moderator', 'pass123');
  const reports = await api.api.get('/reports');
  const appeals = await api.api.get('/appeals');
  assert.ok(Array.isArray(reports));
  assert.ok(Array.isArray(appeals));
});

t('E2E: analyst cannot access admin-ops endpoints (cross-role enforcement)', async () => {
  const { api } = await setupE2E();
  await api.login('test_analyst', 'pass123');
  await assert.rejects(
    api.api.post('/admin/checkpoints/run-now', {}),
    /403/
  );
});

t('E2E: finance cannot access admin-ops endpoints (403)', async () => {
  const { api } = await setupE2E();
  await api.login('test_finance', 'pass123');
  await assert.rejects(
    api.api.get('/admin/recovery/events'),
    /403/
  );
});

t('E2E: admin can access admin-ops endpoints', async () => {
  const { api } = await setupE2E();
  await api.login('test_admin', 'pass123');
  const events = await api.api.get('/admin/recovery/events');
  assert.ok(Array.isArray(events) || events === null || typeof events === 'object');
});

t('E2E: expired / tampered token is rejected', async () => {
  const { api } = await setupE2E();
  api.setToken('not-a-real-jwt.xxx.yyy');
  await assert.rejects(
    api.api.get('/experiments'),
    /401/
  );
});
