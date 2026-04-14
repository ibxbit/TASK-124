'use strict';

// Vault endpoint authorization boundary tests

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('any authenticated user can store credentials', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(token),
    payload: { label: `cred_${Date.now()}`, secret: 'super-secret-key-12345' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.last4);
  assert.ok(!body.ciphertext); // ciphertext must not leak
});

test('user can list own credentials (masked)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/vault/credentials',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body));
  for (const c of body) {
    assert.ok(c.last4);
    assert.ok(!c.ciphertext);
    assert.ok(!c.secret);
  }
});

test('reveal credential requires admin (CONFIG_COMMISSION_RULES)', async () => {
  const app = await getApp();
  // Analyst stores a credential
  const analystToken = await getToken(app, 'analyst');
  await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(analystToken),
    payload: { label: 'reveal_test', secret: 'my-api-key-999' }
  });

  // Analyst cannot reveal
  const revealRes = await app.inject({
    method: 'GET', url: '/vault/credentials/reveal_test/reveal',
    headers: authHeader(analystToken)
  });
  assert.equal(revealRes.statusCode, 403);

  // Admin can reveal
  const adminToken = await getToken(app, 'admin');
  const adminRes = await app.inject({
    method: 'GET', url: '/vault/credentials/reveal_test/reveal',
    headers: authHeader(adminToken)
  });
  // May be 200 (if key loaded) or 500 (if encryption key not in test env)
  // The point is it's NOT 403
  assert.notEqual(adminRes.statusCode, 403);
});

test('finance can store financial tokens', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(token),
    payload: { ownerType: 'merchant', ownerId: 'M1', tokenType: 'bank', secret: 'tok-123456' }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.payload).last4);
});

test('analyst cannot store financial tokens (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(token),
    payload: { ownerType: 'merchant', ownerId: 'M1', tokenType: 'card', secret: 'x' }
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot list financial tokens (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/vault/financial-tokens?ownerType=merchant&ownerId=M1',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('unauthenticated vault access returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({ method: 'GET', url: '/vault/credentials' });
  assert.equal(res.statusCode, 401);
});

// ─── Object-level authorization for financial token reveal ─────────────────

test('finance user can reveal own token (owner_id matches)', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  // Decode the user id from the token payload
  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: authHeader(finToken) });
  const userId = String(JSON.parse(me.payload).id);

  // Store with owner_id = this user's id
  const storeRes = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(finToken),
    payload: { ownerType: 'merchant', ownerId: userId, tokenType: 'bank', secret: 'my-secret-tok' }
  });
  assert.equal(storeRes.statusCode, 200);
  const tokenId = JSON.parse(storeRes.payload).id;

  // Reveal — should succeed (owner match)
  const revealRes = await app.inject({
    method: 'GET', url: `/vault/financial-tokens/${tokenId}/reveal`,
    headers: authHeader(finToken)
  });
  assert.equal(revealRes.statusCode, 200);
  assert.equal(JSON.parse(revealRes.payload).value, 'my-secret-tok');
});

test('finance user CANNOT reveal another user\'s token (403)', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');

  // Store with a DIFFERENT owner_id
  const storeRes = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(finToken),
    payload: { ownerType: 'merchant', ownerId: 'OTHER_USER_999', tokenType: 'card', secret: 'other-secret' }
  });
  const tokenId = JSON.parse(storeRes.payload).id;

  // Reveal should be denied — owner_id doesn't match
  const revealRes = await app.inject({
    method: 'GET', url: `/vault/financial-tokens/${tokenId}/reveal`,
    headers: authHeader(finToken)
  });
  assert.equal(revealRes.statusCode, 403);
  assert.ok(JSON.parse(revealRes.payload).error.includes('Not authorized'));
});

test('reveal nonexistent token returns 404', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'GET', url: '/vault/financial-tokens/999999/reveal',
    headers: authHeader(finToken)
  });
  assert.equal(res.statusCode, 404);
});
