'use strict';

const { getDb } = require('../db/pool');

// Returns the Mon 00:00:00 — Sun 23:59:59.999 range for the week containing `d`.
function weekRangeOf(d) {
  const dt = new Date(d);
  const dayIdx = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - dayIdx);
  monday.setHours(0, 0, 0, 0);
  const sundayEnd = new Date(monday);
  sundayEnd.setDate(monday.getDate() + 6);
  sundayEnd.setHours(23, 59, 59, 999);
  return { start: monday, end: sundayEnd };
}

// Returns the last fully closed accounting week.
// If called before the current week's Sunday 23:59:59 cutoff → returns PREVIOUS week.
// If called after cutoff (i.e., the current second is past Sunday 23:59:59) → returns that week.
function lastClosedWeek(at = new Date()) {
  const now = new Date(at);
  const current = weekRangeOf(now);
  if (now > current.end) return current;            // current week is fully closed
  // Current week still open → step back to the previous week
  const prevDay = new Date(current.start);
  prevDay.setDate(prevDay.getDate() - 1);           // Saturday of prior week
  return weekRangeOf(prevDay);
}

// Back-compat alias used by unit tests
function weekRangeForCutoff(at) { return lastClosedWeek(at); }

async function runCycle(userId, at = new Date()) {
  const { start, end } = lastClosedWeek(at);
  const db = getDb();

  // Idempotent: if a cycle for this period already completed, return it (no duplicate).
  const existing = await db.query(
    `SELECT id, status, total_gross, total_fees, total_net
     FROM settlement_cycles WHERE period_start=$1 AND period_end=$2`, [start, end]);
  if (existing.rows.length && existing.rows[0].status === 'completed') {
    return {
      cycleId: existing.rows[0].id,
      period: { start, end },
      total_gross: Number(existing.rows[0].total_gross),
      total_fees:  Number(existing.rows[0].total_fees),
      total_net:   Number(existing.rows[0].total_net),
      merchants: 0,
      duplicate: true
    };
  }

  const cycle = await db.query(
    `INSERT INTO settlement_cycles (period_start, period_end, status, run_by)
     VALUES ($1,$2,'running',$3)
     ON CONFLICT (period_start, period_end) DO UPDATE SET status='running', run_by=EXCLUDED.run_by
     RETURNING id`,
    [start, end, userId]);
  const cycleId = cycle.rows[0].id;

  try {
    const { rows } = await db.query(
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
      [start, end]);

    let tg = 0, tf = 0, tn = 0;
    for (const r of rows) {
      const gross = Number(r.gross), fees = Number(r.fees), disc = Number(r.discounts);
      const net = Math.round((gross - fees - disc) * 100) / 100;
      await db.query(
        `INSERT INTO settlement_lines (cycle_id, merchant_id, gross, fees, net)
         VALUES ($1,$2,$3,$4,$5)`,
        [cycleId, r.merchant_id, gross, fees, net]);
      tg += gross; tf += fees; tn += net;
    }

    await db.query(
      `UPDATE settlement_cycles
       SET status='completed', total_gross=$1, total_fees=$2, total_net=$3, completed_at=NOW()
       WHERE id=$4`,
      [tg, tf, tn, cycleId]);

    return { cycleId, period: { start, end }, total_gross: tg, total_fees: tf, total_net: tn, merchants: rows.length };
  } catch (err) {
    await db.query(`UPDATE settlement_cycles SET status='failed' WHERE id=$1`, [cycleId]);
    throw err;
  }
}

async function listCycles() {
  const { rows } = await getDb().query(
    `SELECT id, period_start, period_end, status, total_gross, total_fees, total_net, completed_at
     FROM settlement_cycles ORDER BY period_start DESC LIMIT 50`);
  return rows;
}

async function getCycleLines(cycleId) {
  const { rows } = await getDb().query(
    `SELECT merchant_id, gross, fees, net FROM settlement_lines WHERE cycle_id=$1 ORDER BY merchant_id`,
    [cycleId]);
  return rows;
}

module.exports = { runCycle, listCycles, getCycleLines, weekRangeForCutoff, lastClosedWeek, weekRangeOf };
