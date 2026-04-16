'use strict';

// Crash-recovery service.
//
// Runs once at startup (server.js calls restoreAll()) and can be re-invoked
// manually via /admin/recovery/restore. Per kind it:
//
//   1. Fetches the latest checkpoint row.
//   2. Verifies integrity (checksum match against stored payload).
//   3. Restores authoritative state IDEMPOTENTLY — no duplicate processing,
//      no lost tasks.
//   4. Records a row in recovery_events with status + details.
//
// Concurrency: held under a Postgres advisory lock so two processes can't
// recover the same resource at the same time.
//
// Boot identity: a per-process boot_id is stamped into every audit row so
// you can replay exactly what happened during any given startup.

const crypto = require('crypto');
const { getDb } = require('../db/pool');
const checkpointService = require('./checkpointService');
const { verify } = require('./checkpointIntegrity');

const BOOT_ID = crypto.randomBytes(8).toString('hex');
const ADVISORY_LOCK_KEY = 71_234_567;  // arbitrary but stable

// In-memory state exposed to other modules (e.g. experimentService)
const experimentCache = { activeVersions: [], loadedAt: null };

// ─── Helpers ────────────────────────────────────────────────────────────────

async function withAdvisoryLock(fn, { waitMs = 3000, retryEveryMs = 100 } = {}) {
  const db = getDb();
  const client = await db.connect();
  try {
    const deadline = Date.now() + waitMs;
    let got = false;
    while (Date.now() <= deadline) {
      const res = await client.query(`SELECT pg_try_advisory_lock($1) AS got`, [ADVISORY_LOCK_KEY]);
      if (res.rows[0].got) { got = true; break; }
      await new Promise(r => setTimeout(r, retryEveryMs));
    }
    if (!got) {
      const e = new Error('Recovery already in progress (advisory lock held)');
      e.status = 423; throw e;
    }
    try { return await fn(); }
    finally { await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]); }
  } finally {
    client.release();
  }
}

async function log(kind, status, details = {}, checkpointId = null) {
  try {
    await getDb().query(
      `INSERT INTO recovery_events (boot_id, kind, status, checkpoint_id, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [BOOT_ID, kind, status, checkpointId, details]);
  } catch (err) {
    console.error('[recovery] failed to log event:', err.message);
  }
}

function validateCheckpoint(row) {
  if (!row) return { ok: false, reason: 'no_checkpoint' };
  return verify(row);
}

// ─── Settlement — resume IDEMPOTENTLY ───────────────────────────────────────
// For every cycle in 'running' state:
//   - Load its latest verified checkpoint (if any)
//   - DELETE prior settlement_lines (so a partial previous attempt doesn't
//     produce duplicates — satisfies "no duplicate processing")
//   - Re-aggregate and re-insert lines using the cycle's original period
//     (NOT the current week — this preserves historical accuracy)
//   - Mark cycle 'completed' with refreshed totals
// Cycles already 'completed' or 'failed' are left untouched.

async function resumeSettlementCycle(db, cycle) {
  // Recompute from the cycle's stored period to avoid double-counting payments
  // that occurred since the crash.
  const { rows: agg } = await db.query(
    `SELECT p.merchant_id,
            SUM(p.gross_amount)::numeric(14,2) AS gross,
            COALESCE((SELECT SUM(amount) FROM payment_fees f
                      WHERE f.payment_id IN (
                        SELECT id FROM payments
                        WHERE merchant_id=p.merchant_id
                          AND occurred_at BETWEEN $1 AND $2
                          AND state='full')), 0)::numeric(14,2) AS fees,
            COALESCE((SELECT SUM(amount) FROM coupon_allocations a
                      WHERE a.payment_id IN (
                        SELECT id FROM payments
                        WHERE merchant_id=p.merchant_id
                          AND occurred_at BETWEEN $1 AND $2
                          AND state='full')), 0)::numeric(14,2) AS discounts
     FROM payments p
     WHERE p.occurred_at BETWEEN $1 AND $2 AND p.state='full'
     GROUP BY p.merchant_id`,
    [cycle.period_start, cycle.period_end]);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Idempotency: wipe any partial lines before re-inserting.
    await client.query(`DELETE FROM settlement_lines WHERE cycle_id=$1`, [cycle.id]);

    let tg = 0, tf = 0, tn = 0;
    for (const r of agg) {
      const gross = Number(r.gross), fees = Number(r.fees), disc = Number(r.discounts);
      const net = Math.round((gross - fees - disc) * 100) / 100;
      await client.query(
        `INSERT INTO settlement_lines (cycle_id, merchant_id, gross, fees, net)
         VALUES ($1,$2,$3,$4,$5)`,
        [cycle.id, r.merchant_id, gross, fees, net]);
      tg += gross; tf += fees; tn += net;
    }

    await client.query(
      `UPDATE settlement_cycles
       SET status='completed', total_gross=$1, total_fees=$2, total_net=$3, completed_at=NOW()
       WHERE id=$4`,
      [tg, tf, tn, cycle.id]);
    await client.query('COMMIT');

    return { cycleId: cycle.id, merchants: agg.length, totals: { gross: tg, fees: tf, net: tn } };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

async function recoverSettlement() {
  const db = getDb();
  const { rows: running } = await db.query(
    `SELECT id, period_start, period_end, status,
            total_gross, total_fees, total_net
     FROM settlement_cycles WHERE status='running' ORDER BY id`);

  if (!running.length) {
    await log('settlement', 'skipped', { reason: 'no_running_cycles' });
    return { interrupted: 0, resumed: 0, failed: 0, cycles: [] };
  }

  const results = [];
  for (const cycle of running) {
    const cp = await checkpointService.latest('settlement', String(cycle.id));
    const v  = validateCheckpoint(cp);

    if (cp && !v.ok) {
      await log('settlement', 'corrupt',
        { cycleId: cycle.id, reason: v.reason, expected: v.expected, actual: v.actual },
        cp.id);
      // Integrity gate: do NOT use a corrupt checkpoint, but still attempt
      // idempotent resume from authoritative data (the payments table).
    }

    try {
      const summary = await resumeSettlementCycle(db, cycle);
      await log('settlement', 'completed', summary, cp ? cp.id : null);
      results.push({ ...summary, status: 'resumed' });
    } catch (err) {
      await db.query(
        `UPDATE settlement_cycles SET status='failed' WHERE id=$1`, [cycle.id]);
      await log('settlement', 'failed',
        { cycleId: cycle.id, error: err.message }, cp ? cp.id : null);
      results.push({ cycleId: cycle.id, status: 'failed', error: err.message });
    }
  }

  return {
    interrupted: running.length,
    resumed: results.filter(r => r.status === 'resumed').length,
    failed:  results.filter(r => r.status === 'failed').length,
    cycles: results
  };
}

// ─── Moderation queue — verify authoritative DB state against checkpoint ────
// Queue rows live in content_reports / review_appeals / content_appeals and
// never disappear on crash — they're the source of truth. The checkpoint is
// a consistency witness: we compare counts and report drift so an operator
// can tell if something went wrong between last snapshot and now.

async function recoverModerationQueue() {
  const db = getDb();
  const cp = await checkpointService.latest('moderation_queue', 'open');
  const v  = validateCheckpoint(cp);

  if (cp && !v.ok) {
    await log('moderation_queue', 'corrupt',
      { reason: v.reason, expected: v.expected, actual: v.actual }, cp.id);
  }

  const [open, appeals, cAppeals] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM content_reports  WHERE status='open'`),
    db.query(`SELECT COUNT(*)::int AS c FROM review_appeals   WHERE status='pending'`),
    db.query(`SELECT COUNT(*)::int AS c FROM content_appeals  WHERE status='pending'`)
  ]);
  const live = {
    openReports:           open.rows[0].c,
    pendingReviewAppeals:  appeals.rows[0].c,
    pendingContentAppeals: cAppeals.rows[0].c
  };

  const snap = v.ok && cp && cp.payload && cp.payload.counts ? cp.payload.counts : null;
  const drift = snap ? {
    openReports:           live.openReports           - snap.openReports,
    pendingReviewAppeals:  live.pendingReviewAppeals  - snap.pendingReviewAppeals,
    pendingContentAppeals: live.pendingContentAppeals - snap.pendingContentAppeals
  } : null;

  const details = { live, snap, drift, snapshotVerified: v.ok };
  await log('moderation_queue',
    cp ? (v.ok ? 'completed' : 'corrupt') : 'skipped',
    details, cp ? cp.id : null);

  return details;
}

// ─── Experiments — reload active-version cache from DB (source of truth) ────
// Experiments are deterministic from experiment_versions. The checkpoint is
// a fast-load hint only; if it's missing or corrupt we read live.

async function recoverExperiments() {
  const db = getDb();
  const cp = await checkpointService.latest('experiments', 'active_versions');
  const v  = validateCheckpoint(cp);

  if (cp && !v.ok) {
    await log('experiments', 'corrupt',
      { reason: v.reason, expected: v.expected, actual: v.actual }, cp.id);
  }

  // Always re-read live — it's authoritative. Checkpoint used only for
  // comparison so we can spot schedule drift.
  const { rows } = await db.query(
    `SELECT experiment_id, version, start_ts, end_ts, traffic_split
     FROM experiment_versions
     WHERE start_ts <= NOW() AND end_ts >= NOW()
     ORDER BY experiment_id, version`);

  experimentCache.activeVersions = rows;
  experimentCache.loadedAt = new Date();

  const snapCount = v.ok && cp && cp.payload && cp.payload.count != null ? cp.payload.count : null;
  const details = {
    liveCount: rows.length,
    snapshotCount: snapCount,
    drift: snapCount != null ? rows.length - snapCount : null,
    snapshotVerified: v.ok
  };

  await log('experiments',
    cp ? (v.ok ? 'completed' : 'corrupt') : 'skipped',
    details, cp ? cp.id : null);

  return details;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

async function restoreAll() {
  return withAdvisoryLock(async () => {
    await log('all', 'started', { bootId: BOOT_ID });
    const started = Date.now();
    let settlement, moderation, experiments;
    try {
      settlement  = await recoverSettlement();
      moderation  = await recoverModerationQueue();
      experiments = await recoverExperiments();
    } catch (err) {
      await log('all', 'failed', { bootId: BOOT_ID, error: err.message });
      throw err;
    }
    const durationMs = Date.now() - started;
    await log('all', 'completed', {
      bootId: BOOT_ID, durationMs,
      settlement, moderation, experiments
    });
    return {
      bootId: BOOT_ID,
      durationMs,
      settlement,
      moderation,
      experiments,
      restoredAt: new Date().toISOString()
    };
  });
}

async function listRecentEvents(limit = 50) {
  const n = Math.min(Number(limit) || 50, 500);
  const { rows } = await getDb().query(
    `SELECT id, boot_id, kind, status, checkpoint_id, details, created_at
     FROM recovery_events ORDER BY created_at DESC LIMIT $1`, [n]);
  return rows;
}

module.exports = {
  restoreAll, listRecentEvents,
  experimentCache, BOOT_ID,
  // Exposed for unit testing
  _internals: { validateCheckpoint, resumeSettlementCycle }
};
