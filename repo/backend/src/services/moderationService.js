'use strict';

const { getDb } = require('../db/pool');

async function logDecision(client, reviewId, moderatorId, decision, reason) {
  await client.query(
    `INSERT INTO review_decisions (review_id, moderator_id, decision, reason)
     VALUES ($1,$2,$3,$4)`,
    [reviewId, moderatorId, decision, reason || null]);
}

async function hideReview(reviewId, moderatorId, reason) {
  const db = getDb();
  await db.query(`UPDATE reviews SET status='hidden' WHERE id=$1`, [reviewId]);
  await logDecision(db, reviewId, moderatorId, 'hide', reason);
  return { reviewId, status: 'hidden' };
}

async function restoreReview(reviewId, moderatorId, reason) {
  const db = getDb();
  await db.query(`UPDATE reviews SET status='visible' WHERE id=$1`, [reviewId]);
  await logDecision(db, reviewId, moderatorId, 'restore', reason);
  return { reviewId, status: 'visible' };
}

async function submitAppeal(reviewId, reason, appellantId) {
  if (!appellantId) { const e = new Error('appellantId required'); e.status = 400; throw e; }
  const { rows } = await getDb().query(
    `INSERT INTO review_appeals (review_id, reason) VALUES ($1,$2)
     RETURNING id, review_id, reason, status, created_at`,
    [reviewId, reason]
  );
  return rows[0];
}

async function resolveAppeal(appealId, moderatorId, outcome, reason) {
  if (!['upheld', 'overturned'].includes(outcome)) {
    const e = new Error('outcome must be upheld or overturned'); e.status = 400; throw e;
  }
  const db = getDb();
  const { rows } = await db.query(
    `UPDATE review_appeals
     SET status=$1, resolved_at=NOW(), resolved_by=$2
     WHERE id=$3 AND status='pending'
     RETURNING id, review_id, status`,
    [outcome, moderatorId, appealId]);
  if (!rows.length) { const e = new Error('Appeal not found or already resolved'); e.status = 404; throw e; }
  const appeal = rows[0];
  if (outcome === 'overturned') {
    await db.query(`UPDATE reviews SET status='visible' WHERE id=$1`, [appeal.review_id]);
  }
  await logDecision(db, appeal.review_id, moderatorId,
    outcome === 'upheld' ? 'appeal_upheld' : 'appeal_overturned', reason);
  return appeal;
}

async function getDecisionLog(reviewId) {
  const { rows } = await getDb().query(
    `SELECT id, review_id, moderator_id, decision, reason, created_at
     FROM review_decisions WHERE review_id=$1 ORDER BY created_at ASC`,
    [reviewId]);
  return rows;
}

async function listAppeals(opts = {}) {
  const status = opts.status || 'pending';
  const { rows } = await getDb().query(
    `SELECT id, review_id, reason, status, created_at, resolved_at
     FROM review_appeals WHERE status=$1 ORDER BY created_at ASC`, [status]);
  return rows;
}

module.exports = { hideReview, restoreReview, submitAppeal,
                   resolveAppeal, listAppeals, getDecisionLog };
