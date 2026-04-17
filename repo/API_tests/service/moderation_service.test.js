'use strict';

// Deep moderation service tests: hide/restore reviews, appeals lifecycle,
// decision log — exercises the uncovered moderationService lines 26-55.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp, getDb } = require('../helpers');

test.after(closeApp);

async function createReviewForModeration() {
  // Retry once on transient failures — under heavy load (the full 354-test API
  // tier running before this file) the moderator token or POST /reviews
  // occasionally sees a connection reset. Throwing a descriptive error beats
  // `undefined.id` down the line.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = getDb();
    const oliId = `OLI-DEEP-${Date.now()}-${Math.random().toString(36).slice(2)}-${attempt}`;
    const ordId = `ORD-DEEP-${Date.now()}-${attempt}`;
    try {
      await db.query(
        `INSERT INTO order_line_items (id, order_id, sku, quantity) VALUES ($1,$2,$3,$4)`,
        [oliId, ordId, 'WIDGET', 1]);
      const app = await getApp();
      const token = await getToken(app, 'moderator');
      const res = await app.inject({
        method: 'POST', url: '/reviews',
        headers: authHeader(token),
        payload: { orderLineItemId: oliId, orderId: ordId, rating: 3, body: 'meh', tags: [], deviceId: 'dev1' }
      });
      if (res.statusCode === 200) {
        const body = JSON.parse(res.payload);
        const id = (body.review || body).id;
        if (id) return id;
        lastErr = new Error(`review-create returned 200 but no id — body=${res.payload}`);
      } else {
        lastErr = new Error(`review-create returned ${res.statusCode} — body=${res.payload}`);
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw lastErr || new Error('createReviewForModeration failed without a specific error');
}

test('moderationService: hide → restore → decision log round-trip', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  const reviewId = await createReviewForModeration();
  assert.ok(reviewId, 'review must be created first');

  // Hide
  const hidden = await mod.hideReview(reviewId, 1, 'spam');
  assert.equal(hidden.status, 'hidden');

  // Restore
  const restored = await mod.restoreReview(reviewId, 1, 'false positive');
  assert.equal(restored.status, 'visible');

  // Decision log should have 2 entries
  const log = await mod.getDecisionLog(reviewId);
  assert.ok(Array.isArray(log));
  assert.ok(log.length >= 2);
  assert.equal(log[0].decision, 'hide');
  assert.equal(log[1].decision, 'restore');
});

test('moderationService: submitAppeal + resolveAppeal upheld', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  const reviewId = await createReviewForModeration();

  // Hide first
  await mod.hideReview(reviewId, 1, 'test');

  // Submit appeal
  const appeal = await mod.submitAppeal(reviewId, 'I disagree', 'user-99');
  assert.ok(appeal.id);
  assert.equal(appeal.status, 'pending');

  // Resolve as upheld
  const resolved = await mod.resolveAppeal(appeal.id, 1, 'upheld', 'agreed');
  assert.equal(resolved.status, 'upheld');
});

test('moderationService: submitAppeal + resolveAppeal overturned restores review', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  const db = getDb();
  const reviewId = await createReviewForModeration();

  await mod.hideReview(reviewId, 1, 'test');
  const appeal = await mod.submitAppeal(reviewId, 'Please reconsider', 'user-99');

  // Overturned → review should become visible
  await mod.resolveAppeal(appeal.id, 1, 'overturned', 'reconsidered');
  const { rows } = await db.query('SELECT status FROM reviews WHERE id=$1', [reviewId]);
  assert.equal(rows[0].status, 'visible');
});

test('moderationService: resolveAppeal with bad outcome returns 400', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  await assert.rejects(
    mod.resolveAppeal(1, 1, 'invalid_outcome', 'x'),
    (err) => err.status === 400
  );
});

test('moderationService: resolveAppeal on non-existent appeal returns 404', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  await assert.rejects(
    mod.resolveAppeal(999999, 1, 'upheld', 'x'),
    (err) => err.status === 404
  );
});

test('moderationService: listAppeals returns pending by default', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  const list = await mod.listAppeals();
  assert.ok(Array.isArray(list));
  for (const a of list) assert.equal(a.status, 'pending');
});

test('moderationService: submitAppeal without appellantId returns 400', async () => {
  await getApp();
  const mod = require('../../backend/src/services/moderationService');
  await assert.rejects(
    mod.submitAppeal(1, 'reason', null),
    (err) => err.status === 400
  );
});
