'use strict';

const { getDb } = require('../db/pool');
const fees = require('./feeCalculator');

const TRANSITIONS = {
  pre_auth: new Set(['deposit', 'full']),
  deposit:  new Set(['full']),
  full:     new Set([])
};

async function insertPayment(client, p, importedFileId) {
  const { rows } = await client.query(
    `INSERT INTO payments
       (external_id, provider, merchant_id, order_id, state,
        gross_amount, occurred_at, imported_file_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (external_id) DO NOTHING
     RETURNING id, external_id, provider, merchant_id, order_id, state, gross_amount, occurred_at`,
    [p.externalId, p.provider, p.merchantId, p.orderId, p.state,
     p.grossAmount, p.occurredAt, importedFileId]);
  if (!rows.length) return null;
  await client.query(
    `INSERT INTO payment_transitions (payment_id, from_state, to_state)
     VALUES ($1, NULL, $2)`, [rows[0].id, p.state]);
  return rows[0];
}

async function applyCouponIfProvided(client, paymentId, couponCode) {
  if (!couponCode) return 0;
  const c = await client.query(
    `SELECT id, kind, value FROM coupons WHERE code=$1 AND active=TRUE`, [couponCode]);
  if (!c.rows.length) return 0;
  const p = await client.query(`SELECT gross_amount FROM payments WHERE id=$1`, [paymentId]);
  const gross = Number(p.rows[0].gross_amount);
  const coupon = c.rows[0];
  const amount = coupon.kind === 'fixed'
    ? Math.min(Number(coupon.value), gross)
    : gross * Number(coupon.value);
  const rounded = Math.round(amount * 100) / 100;
  await client.query(
    `INSERT INTO coupon_allocations (payment_id, coupon_id, amount) VALUES ($1,$2,$3)`,
    [paymentId, coupon.id, rounded]);
  return rounded;
}

async function writeFeesAndLedger(client, payment, feeItems, discount) {
  for (const f of feeItems) {
    await client.query(
      `INSERT INTO payment_fees (payment_id, fee_type, amount, description)
       VALUES ($1,$2,$3,$4)`,
      [payment.id, f.fee_type, f.amount, f.description]);
  }

  const totalFees = feeItems.reduce((s, f) => s + Number(f.amount), 0);
  const net = Math.round((Number(payment.gross_amount) - totalFees - discount) * 100) / 100;

  await client.query(
    `INSERT INTO ledger_entries (payment_id, account, credit, memo) VALUES ($1,$2,$3,$4)`,
    [payment.id, `merchant:${payment.merchant_id}`, net, 'net payout']);

  for (const f of feeItems) {
    const account = f.fee_type === 'sales_tax'  ? 'tax:sales'
                  : f.fee_type === 'commission' ? 'platform:commission'
                  : `platform:${f.fee_type}`;
    await client.query(
      `INSERT INTO ledger_entries (payment_id, account, debit, memo) VALUES ($1,$2,$3,$4)`,
      [payment.id, account, f.amount, f.description]);
  }
  if (discount > 0) {
    await client.query(
      `INSERT INTO ledger_entries (payment_id, account, debit, memo)
       VALUES ($1, 'promotions:discount', $2, 'coupon')`,
      [payment.id, discount]);
  }
}

async function createPayment(input, opts = {}) {
  const { importedFileId = null, couponCode = null } = opts;
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const payment = await insertPayment(client, input, importedFileId);
    if (!payment) { await client.query('ROLLBACK'); return null; }
    const discount = await applyCouponIfProvided(client, payment.id, couponCode);
    const feeItems = await fees.computeFees(
      { provider: payment.provider, grossAmount: payment.gross_amount },
      { discountAmount: discount });
    await writeFeesAndLedger(client, payment, feeItems, discount);
    await client.query('COMMIT');
    return { payment, discount, fees: feeItems };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

async function transition(paymentId, toState, actorId, reason) {
  const db = getDb();
  const { rows } = await db.query(`SELECT state FROM payments WHERE id=$1`, [paymentId]);
  if (!rows.length) { const e = new Error('Payment not found'); e.status = 404; throw e; }
  const from = rows[0].state;
  if (!TRANSITIONS[from] || !TRANSITIONS[from].has(toState)) {
    const e = new Error(`Illegal transition ${from} -> ${toState}`); e.status = 409; throw e;
  }
  await db.query(`UPDATE payments SET state=$1 WHERE id=$2`, [toState, paymentId]);
  await db.query(
    `INSERT INTO payment_transitions (payment_id, from_state, to_state, actor_id, reason)
     VALUES ($1,$2,$3,$4,$5)`,
    [paymentId, from, toState, actorId, reason || null]);
  return { paymentId, from, to: toState };
}

module.exports = { createPayment, transition };
