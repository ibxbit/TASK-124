'use strict';

const { getDb } = require('../db/pool');

const RATES = {
  service:   0.005,  // 0.5%
  platform:  0.010,  // 1.0%
  surcharge: 0,
  salesTax:  0.060   // 6.0%
};

async function getCommissionRate(provider) {
  const db = getDb();
  const override = await db.query(
    `SELECT rate FROM commission_rates WHERE provider = $1`, [provider]);
  if (override.rows.length) return Number(override.rows[0].rate);
  const def = await db.query(`SELECT rate FROM commission_rates WHERE provider IS NULL`);
  return Number(def.rows[0].rate);
}

function round2(n) { return Math.round(n * 100) / 100; }

async function computeFees(payment, opts = {}) {
  const discountAmount = Number(opts.discountAmount || 0);
  const taxable = Math.max(0, Number(payment.grossAmount) - discountAmount);
  const commissionRate = await getCommissionRate(payment.provider);
  return [
    { fee_type: 'service',    amount: round2(taxable * RATES.service),    description: 'Service fee 0.5%' },
    { fee_type: 'platform',   amount: round2(taxable * RATES.platform),   description: 'Platform fee 1.0%' },
    { fee_type: 'surcharge',  amount: round2(taxable * RATES.surcharge),  description: 'Surcharge' },
    { fee_type: 'sales_tax',  amount: round2(taxable * RATES.salesTax),   description: 'Sales tax 6.0%' },
    { fee_type: 'commission', amount: round2(taxable * commissionRate),   description: `Commission ${(commissionRate * 100).toFixed(2)}%` }
  ];
}

async function setCommissionRate(provider, rate, userId) {
  if (rate < 0 || rate > 1) { const e = new Error('rate must be 0..1'); e.status = 400; throw e; }
  const { rows } = await getDb().query(
    `INSERT INTO commission_rates (provider, rate, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (provider) DO UPDATE
       SET rate=EXCLUDED.rate, updated_by=EXCLUDED.updated_by, updated_at=NOW()
     RETURNING provider, rate, updated_at`,
    [provider || null, rate, userId]);
  return rows[0];
}

async function listCommissionRates() {
  const { rows } = await getDb().query(
    `SELECT provider, rate, updated_at FROM commission_rates ORDER BY provider NULLS FIRST`);
  return rows;
}

module.exports = { computeFees, getCommissionRate, setCommissionRate, listCommissionRates };
