'use strict';

const { getDb } = require('../db/pool');

async function getRule(key) {
  const { rows } = await getDb().query(
    `SELECT value FROM risk_rules WHERE key=$1`, [key]);
  return rows.length ? Number(rows[0].value) : null;
}

async function listRules() {
  const { rows } = await getDb().query(
    `SELECT key, value, updated_at FROM risk_rules ORDER BY key`);
  return rows;
}

async function setRule(key, value, userId) {
  if (!Number.isFinite(value)) { const e = new Error('value must be numeric'); e.status = 400; throw e; }
  const { rows } = await getDb().query(
    `INSERT INTO risk_rules (key, value, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (key) DO UPDATE
       SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()
     RETURNING key, value, updated_at`,
    [key, value, userId]);
  return rows[0];
}

async function evaluate({ provider }) {
  const db = getDb();
  const flags = [];

  const dailyLimit = (await getRule('max_refunds_per_day_per_provider')) || 3;
  const daily = await db.query(
    `SELECT COUNT(*)::int AS c FROM refunds
     WHERE provider=$1 AND status <> 'rejected'
       AND created_at >= NOW() - INTERVAL '1 day'`,
    [provider]);
  if (daily.rows[0].c >= dailyLimit) {
    flags.push({ rule: 'refunds_per_day_per_provider', threshold: dailyLimit, observed: daily.rows[0].c });
  }

  const rateLimit = (await getRule('max_refund_rate_7d')) || 0.15;
  const totals = await db.query(
    `SELECT
       COALESCE((SELECT SUM(gross_amount) FROM payments
                 WHERE provider=$1 AND occurred_at >= NOW() - INTERVAL '7 days'), 0)::numeric AS gross,
       COALESCE((SELECT SUM(amount) FROM refunds
                 WHERE provider=$1 AND status <> 'rejected'
                   AND created_at >= NOW() - INTERVAL '7 days'), 0)::numeric AS refunded`,
    [provider]);
  const gross    = Number(totals.rows[0].gross);
  const refunded = Number(totals.rows[0].refunded);
  const rate = gross > 0 ? refunded / gross : 0;
  if (rate > rateLimit) {
    flags.push({ rule: 'refund_rate_7d', threshold: rateLimit, observed: rate, gross, refunded });
  }

  return flags;
}

module.exports = { evaluate, getRule, setRule, listRules };
