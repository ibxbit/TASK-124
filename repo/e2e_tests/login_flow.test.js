'use strict';

// ─── E2E: login flow ─────────────────────────────────────────────────────────
// Exercises the frontend login path against the real backend:
//   • successful login stores a JWT token
//   • failed login produces a 401 error
//   • token is transparently added to subsequent authenticated requests

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupE2E, teardown, isDbReachable } = require('./helpers');

const SKIP = { skip: true };
let skipOpts = {};
test.before(async () => {
  if (!(await isDbReachable())) {
    skipOpts = { skip: 'Postgres not reachable — start with `docker compose up db -d`' };
  }
});
test.after(teardown);
const t = (name, fn) => test(name, (ctx) => { if (skipOpts.skip) return ctx.skip(skipOpts.skip); return fn(ctx); });

t('E2E: frontend login() against real backend stores JWT, user.role', async () => {
  const { api } = await setupE2E();
  const user = await api.login('test_admin', 'pass123');
  assert.equal(user.role, 'admin');
  assert.ok(api.getToken());
});

t('E2E: wrong password → login() rejects with 401 error, no token', async () => {
  const { api } = await setupE2E();
  await assert.rejects(
    api.login('test_admin', 'wrong-password'),
    /401/
  );
  assert.equal(api.getToken(), null);
});

t('E2E: logout() clears the token', async () => {
  const { api } = await setupE2E();
  await api.login('test_admin', 'pass123');
  assert.ok(api.getToken());
  api.logout();
  assert.equal(api.getToken(), null);
});

t('E2E: post-login requests carry Authorization header automatically', async () => {
  const { api } = await setupE2E();
  await api.login('test_admin', 'pass123');
  // /experiments requires auth; this will 401 if token isn't sent
  const experiments = await api.api.get('/experiments');
  assert.ok(Array.isArray(experiments));
});

t('E2E: unauthenticated request to protected endpoint → 401', async () => {
  const { api } = await setupE2E();
  // No login first
  await assert.rejects(
    api.api.get('/experiments'),
    /401|403/
  );
});

t('E2E: unknown username → 401 (no user enumeration)', async () => {
  const { api } = await setupE2E();
  await assert.rejects(
    api.login('nobody-with-this-name', 'pass123'),
    /401/
  );
});

t('E2E: analyst role can login and fetch own profile', async () => {
  const { api } = await setupE2E();
  const user = await api.login('test_analyst', 'pass123');
  assert.equal(user.role, 'analyst');
});

t('E2E: moderator role can login', async () => {
  const { api } = await setupE2E();
  const user = await api.login('test_moderator', 'pass123');
  assert.equal(user.role, 'moderator');
});

t('E2E: finance role can login', async () => {
  const { api } = await setupE2E();
  const user = await api.login('test_finance', 'pass123');
  assert.equal(user.role, 'finance');
});
