'use strict';

const { getDb } = require('../db/pool');
const risk = require('./riskService');

async function writeAudit(client, refundId, actorId, action, details = {}) {
  await client.query(
    `INSERT INTO refund_audit (refund_id, actor_id, action, details) VALUES ($1,$2,$3,$4)`,
    [refundId, actorId, action, details]);
}

async function getPayment(db, paymentId) {
  const { rows } = await db.query(
    `SELECT id, provider, merchant_id, gross_amount FROM payments WHERE id=$1`, [paymentId]);
  return rows[0] || null;
}

async function refundedSoFar(db, paymentId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS s FROM refunds
     WHERE payment_id=$1 AND status <> 'rejected'`, [paymentId]);
  return Number(rows[0].s);
}

async function createRefund(input, userId) {
  let { paymentId, amount, reason, provider } = input;
  amount = Number(amount);
  if (!paymentId || !(amount > 0)) {
    const e = new Error('paymentId and positive amount required'); e.status = 400; throw e;
  }
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const payment = await getPayment(client, paymentId);
    if (!payment) { const e = new Error('Payment not found'); e.status = 404; throw e; }
    if (provider && provider !== payment.provider) {
      const e = new Error(`provider mismatch: refund must use ${payment.provider}`);
      e.status = 400; throw e;
    }
    const already = await refundedSoFar(client, payment.id);
    const remaining = Number(payment.gross_amount) - already;
    if (amount > remaining + 1e-9) {
      const e = new Error(`amount exceeds refundable balance (${remaining.toFixed(2)})`);
      e.status = 400; throw e;
    }
    const flags = await risk.evaluate({ provider: payment.provider });
    const status = flags.length ? 'pending_review' : 'approved';

    const ins = await client.query(
      `INSERT INTO refunds (payment_id, provider, amount, reason, status, risk_flags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, payment_id, provider, amount, reason, status, risk_flags, created_at`,
      [payment.id, payment.provider, amount, reason || null, status,
       JSON.stringify(flags), userId]);
    const refund = ins.rows[0];

    await writeAudit(client, refund.id, userId, 'create',
      { amount, reason, status, risk_flags: flags });
    await client.query('COMMIT');
    return refund;
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

async function editRefund(id, patch, userId) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT * FROM refunds WHERE id=$1 FOR UPDATE`, [id]);
    if (!cur.rows.length) { const e = new Error('Refund not found'); e.status = 404; throw e; }
    const r = cur.rows[0];
    if (!['pending', 'pending_review', 'approved'].includes(r.status)) {
      const e = new Error(`Cannot edit refund in state ${r.status}`); e.status = 409; throw e;
    }
    const nextAmount = patch.amount != null ? Number(patch.amount) : Number(r.amount);
    if (!(nextAmount > 0)) { const e = new Error('amount must be > 0'); e.status = 400; throw e; }

    const payment = await getPayment(client, r.payment_id);
    const otherRefunded = (await refundedSoFar(client, r.payment_id)) - Number(r.amount);
    if (nextAmount > Number(payment.gross_amount) - otherRefunded + 1e-9) {
      const e = new Error('edit exceeds refundable balance'); e.status = 400; throw e;
    }
    await client.query(
      `UPDATE refunds SET amount=$1, reason=COALESCE($2, reason) WHERE id=$3`,
      [nextAmount, patch.reason ?? null, id]);
    await writeAudit(client, id, userId, 'edit',
      { before: { amount: r.amount, reason: r.reason },
        after:  { amount: nextAmount, reason: patch.reason } });
    await client.query('COMMIT');
    return { id, amount: nextAmount, reason: patch.reason ?? r.reason };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

async function approveRefund(id, userId, note) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE refunds SET status='approved', reviewed_by=$1, reviewed_at=NOW()
       WHERE id=$2 AND status='pending_review' RETURNING id, status`, [userId, id]);
    if (!rows.length) { const e = new Error('Refund not in pending_review'); e.status = 409; throw e; }
    await writeAudit(client, id, userId, 'approve', { note });
    await client.query('COMMIT');
    return rows[0];
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

async function rejectRefund(id, userId, note) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE refunds SET status='rejected', reviewed_by=$1, reviewed_at=NOW()
       WHERE id=$2 AND status IN ('pending','pending_review','approved')
       RETURNING id, status`, [userId, id]);
    if (!rows.length) { const e = new Error('Refund not rejectable'); e.status = 409; throw e; }
    await writeAudit(client, id, userId, 'reject', { note });
    await client.query('COMMIT');
    return rows[0];
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

async function executeRefund(id, userId) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT r.*, p.merchant_id FROM refunds r
       JOIN payments p ON p.id=r.payment_id
       WHERE r.id=$1 FOR UPDATE`, [id]);
    if (!cur.rows.length) { const e = new Error('Refund not found'); e.status = 404; throw e; }
    const r = cur.rows[0];
    if (r.status !== 'approved') {
      const e = new Error(`Refund must be approved (currently ${r.status})`); e.status = 409; throw e;
    }
    await client.query(
      `INSERT INTO ledger_entries (payment_id, account, debit, memo) VALUES ($1,$2,$3,$4)`,
      [r.payment_id, `merchant:${r.merchant_id}`, r.amount, `refund #${r.id}`]);
    await client.query(
      `INSERT INTO ledger_entries (payment_id, account, credit, memo) VALUES ($1,$2,$3,$4)`,
      [r.payment_id, `refunds:${r.provider}`, r.amount, `refund #${r.id}`]);
    await client.query(
      `UPDATE refunds SET status='executed', executed_by=$1, executed_at=NOW() WHERE id=$2`,
      [userId, id]);
    await writeAudit(client, id, userId, 'execute', { amount: Number(r.amount), provider: r.provider });
    await client.query('COMMIT');
    return { id, status: 'executed' };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

async function listRefunds(opts = {}) {
  const { status, provider, limit = 100, offset = 0 } = opts;
  const params = [];
  const conds = [];
  if (status)   { params.push(status);   conds.push(`status=$${params.length}`); }
  if (provider) { params.push(provider); conds.push(`provider=$${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await getDb().query(
    `SELECT id, payment_id, provider, amount, reason, status, risk_flags, created_at
     FROM refunds ${where} ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows;
}

async function getAudit(refundId) {
  const { rows } = await getDb().query(
    `SELECT id, refund_id, actor_id, action, details, created_at
     FROM refund_audit WHERE refund_id=$1 ORDER BY created_at ASC`, [refundId]);
  return rows;
}

module.exports = {
  createRefund, editRefund, approveRefund, rejectRefund, executeRefund,
  listRefunds, getAudit
};
