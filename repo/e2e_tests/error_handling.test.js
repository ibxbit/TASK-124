'use strict';

// ─── E2E: error handling and permission boundaries ──────────────────────────
// The frontend surfaces backend errors verbatim in `status = e.message`.
// We verify the full error propagation chain: HTTP status → api.js throw →
// component-level error message format.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupE2E, teardown, isDbReachable } = require('./helpers');

test.after(teardown);
let skipOpts = {};test.before(async () => { if (!(await isDbReachable())) skipOpts = { skip: 'Postgres not reachable' }; });const t = (name, fn) => test(name, (ctx) => { if (skipOpts.skip) return ctx.skip(skipOpts.skip); return fn(ctx); });

t('E2E: missing required fields → 400 with descriptive error', async () => {
  const { api } = await setupE2E();
  await api.login('test_admin', 'pass123');
  try {
    await api.api.post('/auth/register', { username: 'x' }); // missing password & role
    assert.fail('Expected 400');
  } catch (e) {
    assert.match(e.message, /^400/);
  }
});

t('E2E: non-admin POST /auth/register → 403 Forbidden', async () => {
  const { api } = await setupE2E();
  await api.login('test_analyst', 'pass123');
  await assert.rejects(
    api.api.post('/auth/register', { username: 'u', password: 'p', role: 'analyst' }),
    /403/
  );
});

t('E2E: 404 for non-existent endpoint is surfaced with 404 status in message', async () => {
  const { api } = await setupE2E();
  await api.login('test_admin', 'pass123');
  await assert.rejects(
    api.api.get('/this-endpoint-does-not-exist'),
    /404/
  );
});

t('E2E: invalid token format → 401 on any protected endpoint', async () => {
  const { api } = await setupE2E();
  api.setToken('definitely-not-a-jwt');
  await assert.rejects(
    api.api.get('/experiments'),
    /401/
  );
});

t('E2E: token from one user, trying to hit admin endpoints → 403', async () => {
  const { api } = await setupE2E();
  await api.login('test_moderator', 'pass123');
  await assert.rejects(
    api.api.post('/admin/snapshots', { label: 'should-fail' }),
    /403/
  );
});

t('E2E: analyst can view experiments list but not delete', async () => {
  const { api } = await setupE2E();
  await api.login('test_analyst', 'pass123');
  const list = await api.api.get('/experiments');
  assert.ok(Array.isArray(list));
  if (list.length > 0) {
    await assert.rejects(
      api.api.delete(`/experiments/${list[0].id}`),
      /403|405|404/
    );
  }
});

t('E2E: /auth/login with empty password returns 4xx', async () => {
  const { api } = await setupE2E();
  await assert.rejects(
    api.login('test_admin', ''),
    /4\d\d/
  );
});

t('E2E: health endpoint is always accessible (no auth)', async () => {
  const { api } = await setupE2E();
  const h = await api.api.get('/health');
  assert.ok(h);
  assert.equal(h.status, 'ok');
});
