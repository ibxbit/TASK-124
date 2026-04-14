'use strict';

// Audit finding: Cross-user object access denial — API test coverage
//
// Tests that users cannot access, modify, or delete objects owned by
// other users across all domains: vault credentials, follows, likes,
// comments, and financial tokens.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Vault credentials: cross-user isolation ────────────────────────────────

test('user cannot list another user\'s vault credentials', async () => {
  const app = await getApp();
  const tokenA = await getToken(app, 'analyst');
  const tokenB = await getToken(app, 'finance');

  const label = `cross_cred_${Date.now()}`;
  await app.inject({
    method: 'POST', url: '/vault/credentials',
    headers: authHeader(tokenA),
    payload: { label, secret: 'user-a-only-secret' }
  });

  const listRes = await app.inject({
    method: 'GET', url: '/vault/credentials',
    headers: authHeader(tokenB)
  });
  const creds = JSON.parse(listRes.payload);
  assert.ok(!creds.find(c => c.label === label),
    'User B should not see User A\'s credentials');
});

// ── Financial tokens: cross-user reveal denied ─────────────────────────────

test('finance user cannot reveal financial token owned by another user', async () => {
  const app = await getApp();
  const finToken = await getToken(app, 'finance');

  // Store a token with owner_id that doesn't match the finance user
  const storeRes = await app.inject({
    method: 'POST', url: '/vault/financial-tokens',
    headers: authHeader(finToken),
    payload: {
      ownerType: 'merchant',
      ownerId: 'CROSS_USER_DENY',
      tokenType: 'card',
      secret: 'cross-user-secret'
    }
  });
  const tokenId = JSON.parse(storeRes.payload).id;

  // Reveal should be denied — owner_id doesn't match finance user's id
  const revealRes = await app.inject({
    method: 'GET', url: `/vault/financial-tokens/${tokenId}/reveal`,
    headers: authHeader(finToken)
  });
  assert.equal(revealRes.statusCode, 403);
  assert.ok(JSON.parse(revealRes.payload).error.includes('Not authorized'));
});

// ── Follow: user can only unfollow their own follows ───────────────────────

test('follow and unfollow are scoped to the authenticated user', async () => {
  const app = await getApp();
  const tokenA = await getToken(app, 'analyst');
  const tokenB = await getToken(app, 'finance');

  // User A follows user id "target_user_42"
  const followRes = await app.inject({
    method: 'POST', url: '/follows',
    headers: authHeader(tokenA),
    payload: { followeeId: 'target_user_42' }
  });
  assert.equal(followRes.statusCode, 200);

  // User B tries to unfollow the same target — should succeed silently
  // (it just removes user B's follow of target, which doesn't exist)
  const unfollowRes = await app.inject({
    method: 'DELETE', url: '/follows/target_user_42',
    headers: authHeader(tokenB)
  });
  // Should not error (idempotent delete)
  assert.equal(unfollowRes.statusCode, 200);

  // Verify user A's follow is still intact
  const meA = await app.inject({
    method: 'GET', url: '/auth/me',
    headers: authHeader(tokenA)
  });
  const userAId = String(JSON.parse(meA.payload).id);
  const followingRes = await app.inject({
    method: 'GET', url: `/users/${userAId}/following`,
    headers: authHeader(tokenA)
  });
  const following = JSON.parse(followingRes.payload);
  assert.ok(following.some(f => f.followee_id === 'target_user_42'),
    'User A\'s follow should not be affected by User B\'s unfollow');
});

// ── Likes: scoped to authenticated user ────────────────────────────────────

test('user can only remove their own likes', async () => {
  const app = await getApp();
  const tokenA = await getToken(app, 'analyst');
  const tokenB = await getToken(app, 'finance');

  // User A likes something
  await app.inject({
    method: 'POST', url: '/likes',
    headers: authHeader(tokenA),
    payload: { targetType: 'review', targetId: 777, kind: 'like' }
  });

  // User B tries to remove that like — should not affect A's like
  await app.inject({
    method: 'DELETE', url: '/likes',
    headers: authHeader(tokenB),
    payload: { targetType: 'review', targetId: 777, kind: 'like' }
  });

  // Check count is still 1 (A's like persists)
  const countRes = await app.inject({
    method: 'GET', url: '/likes/count?targetType=review&targetId=777&kind=like',
    headers: authHeader(tokenA)
  });
  assert.equal(JSON.parse(countRes.payload).count, 1);
});

// ── Reports: non-moderator cannot resolve ──────────────────────────────────

test('analyst cannot resolve another user\'s report', async () => {
  const app = await getApp();
  const analystToken = await getToken(app, 'analyst');

  // Create a report
  const createRes = await app.inject({
    method: 'POST', url: '/reports',
    headers: authHeader(analystToken),
    payload: { targetType: 'comment', targetId: 888, reason: 'cross_access_test' }
  });
  assert.equal(createRes.statusCode, 200);
  const reportId = JSON.parse(createRes.payload).id;

  // Analyst tries to resolve — should be denied (need REPORT_HANDLE)
  const resolveRes = await app.inject({
    method: 'POST', url: `/reports/${reportId}/resolve`,
    headers: authHeader(analystToken),
    payload: { outcome: 'no_action' }
  });
  assert.equal(resolveRes.statusCode, 403);
});

// ── Refund audit trail: scoped by permission ───────────────────────────────

test('analyst cannot access refund operations (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/refunds',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot access refunds (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'GET', url: '/refunds',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 403);
});

// ── Unauthenticated access denied ──────────────────────────────────────────

test('unauthenticated follow returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/follows',
    payload: { followeeId: 'someone' }
  });
  assert.equal(res.statusCode, 401);
});

test('unauthenticated like returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/likes',
    payload: { targetType: 'review', targetId: 1, kind: 'like' }
  });
  assert.equal(res.statusCode, 401);
});
