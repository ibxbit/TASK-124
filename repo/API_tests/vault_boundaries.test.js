'use strict';

// Audit finding: Vault secret access boundaries — API test coverage
//
// Tests that vault secrets are properly bounded by user/role, that
// cross-user access is denied, and that credential secrets never leak
// in list/store responses.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Credential isolation: user A cannot see user B's credentials ──────────

test('user credentials are scoped to the owning user', async () => {
  const app = await getApp();
  const tokenA = await getToken(app, 'analyst');
  const tokenB = await getToken(app, 'moderator');

  // User A stores a credential
  const label = `iso_${Date.now()}`;
  await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(tokenA),
    payload: { label, secret: 'user-a-secret' }
  });

  // User B lists credentials — should NOT see user A's
  const listRes = await app.inject({
    method: 'GET', url: '/vault/credentials',
    headers: authHeader(tokenB)
  });
  assert.equal(listRes.statusCode, 200);
  const creds = JSON.parse(listRes.payload);
  const found = creds.find(c => c.label === label);
  assert.equal(found, undefined, 'User B should not see User A credentials');
});

// ── Credential reveal scoped to owning user ───────────────────────────────

test('reveal credential for non-owning user returns 404 (scoped by user_id)', async () => {
  const app = await getApp();
  const tokenA = await getToken(app, 'analyst');
  const label = `reveal_iso_${Date.now()}`;
  await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(tokenA),
    payload: { label, secret: 'my-secret-99' }
  });

  // Admin can reveal (has CONFIG_COMMISSION_RULES) but the query is
  // scoped to the admin's user.id, not analyst's — so should return 404.
  const adminToken = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: `/vault/credentials/${label}/reveal`,
    headers: authHeader(adminToken)
  });
  // revealCredential queries by user_id + label; admin's user_id != analyst's
  // so it returns null → 404
  assert.equal(res.statusCode, 404);
});

// ── Financial token: admin can reveal any token ───────────────────────────

test('admin can reveal any financial token regardless of owner_id', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const storeRes = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(finToken),
    payload: { ownerType: 'merchant', ownerId: 'ADMIN_TEST', tokenType: 'bank', secret: 'admin-can-see' }
  });
  const tokenId = JSON.parse(storeRes.payload).id;

  const adminToken = await getToken(app, 'admin');
  const revealRes = await app.inject({
    method: 'GET', url: `/vault/financial-tokens/${tokenId}/reveal`,
    headers: authHeader(adminToken)
  });
  assert.equal(revealRes.statusCode, 200);
  assert.equal(JSON.parse(revealRes.payload).value, 'admin-can-see');
});

// ── Store response never leaks ciphertext ─────────────────────────────────

test('financial token store response contains last4 but not ciphertext', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(token),
    payload: { ownerType: 'merchant', ownerId: 'LEAK_TEST', tokenType: 'card', secret: 'tok-secret-abcdef' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.last4);
  assert.equal(body.last4, 'cdef');
  assert.ok(!body.ciphertext, 'ciphertext must not appear in response');
  assert.ok(!body.secret, 'secret must not appear in response');
});

test('financial token list response contains last4 but not ciphertext', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  // Store one first
  await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(token),
    payload: { ownerType: 'merchant', ownerId: 'LIST_LEAK', tokenType: 'bank', secret: 'list-secret-9999' }
  });

  const res = await app.inject({
    method: 'GET', url: '/vault/financial-tokens?ownerType=merchant&ownerId=LIST_LEAK',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const tokens = JSON.parse(res.payload);
  assert.ok(tokens.length > 0);
  for (const t of tokens) {
    assert.ok(t.last4);
    assert.ok(!t.ciphertext, 'ciphertext must not appear in list');
    assert.ok(!t.secret, 'secret must not appear in list');
  }
});

// ── Missing required fields ───────────────────────────────────────────────

test('store credential without label returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(token),
    payload: { secret: 'no-label' }
  });
  assert.equal(res.statusCode, 400);
});

test('store financial token without required fields returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(token),
    payload: { ownerType: 'merchant' } // missing ownerId, tokenType, secret
  });
  assert.equal(res.statusCode, 400);
});

// ── Moderator cannot access financial tokens ──────────────────────────────

test('moderator cannot reveal financial tokens (403)', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const storeRes = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(finToken),
    payload: { ownerType: 'merchant', ownerId: 'MOD_DENY', tokenType: 'bank', secret: 'mod-cant-see' }
  });
  const tokenId = JSON.parse(storeRes.payload).id;

  const modToken = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: `/vault/financial-tokens/${tokenId}/reveal`,
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 403);
});

test('analyst cannot reveal financial tokens (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/vault/financial-tokens/1/reveal',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});
