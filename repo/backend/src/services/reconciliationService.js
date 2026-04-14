'use strict';

// ExcelJS lazy-loaded: xlsx exports only (CSV path avoids this cost entirely)
let _ExcelJS = null;
function getExcelJS() { return _ExcelJS || (_ExcelJS = require('exceljs')); }
const { PassThrough } = require('stream');
const { getDb } = require('../db/pool');

function pad2(n) { return String(n).padStart(2, '0'); }

function formatMDY(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}/${dt.getFullYear()}`;
}

function parseMDY(value, endOfDay = false) {
  if (!value) return null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value));
  let dt;
  if (mdy) dt = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  else     dt = new Date(value);
  if (isNaN(dt)) { const e = new Error('Invalid date; expected MM/DD/YYYY'); e.status = 400; throw e; }
  if (endOfDay) dt.setHours(23, 59, 59, 999); else dt.setHours(0, 0, 0, 0);
  return dt;
}

async function fetchSummary(from, to) {
  const { rows } = await getDb().query(
    `SELECT
       p.merchant_id,
       COUNT(DISTINCT p.id)::int AS payments,
       COALESCE(SUM(p.gross_amount), 0)::numeric(14,2) AS gross,
       COALESCE((SELECT SUM(amount) FROM payment_fees f
                 WHERE f.payment_id IN (
                   SELECT id FROM payments
                   WHERE merchant_id=p.merchant_id
                     AND occurred_at BETWEEN $1 AND $2
                     AND state='full')), 0)::numeric(14,2) AS fees,
       COALESCE((SELECT SUM(amount) FROM refunds r
                 WHERE r.payment_id IN (
                   SELECT id FROM payments
                   WHERE merchant_id=p.merchant_id
                     AND occurred_at BETWEEN $1 AND $2)
                   AND r.status='executed'), 0)::numeric(14,2) AS refunds
     FROM payments p
     WHERE p.occurred_at BETWEEN $1 AND $2 AND p.state='full'
     GROUP BY p.merchant_id
     ORDER BY p.merchant_id`,
    [from, to]);
  return rows.map(r => {
    const gross = Number(r.gross), fees = Number(r.fees), refunds = Number(r.refunds);
    return {
      merchant_id: r.merchant_id,
      payments: r.payments,
      gross, fees, refunds,
      net: Math.round((gross - fees - refunds) * 100) / 100
    };
  });
}

async function fetchDetail(from, to) {
  const { rows } = await getDb().query(
    `SELECT id, payment_id, account, debit, credit, currency, occurred_at, memo
     FROM ledger_entries WHERE occurred_at BETWEEN $1 AND $2
     ORDER BY occurred_at ASC, id ASC`,
    [from, to]);
  return rows;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsvToStream(stream, headerLines, columns, rows) {
  for (const line of headerLines) stream.write(line + '\r\n');
  stream.write('\r\n');
  stream.write(columns.map(csvEscape).join(',') + '\r\n');
  for (const r of rows) {
    stream.write(columns.map(c => csvEscape(r[c])).join(',') + '\r\n');
  }
  stream.end();
}

async function writeXlsxToStream(stream, headerLines, columns, rows, sheetName) {
  const wb = new (getExcelJS()).stream.xlsx.WorkbookWriter({ stream });
  const ws = wb.addWorksheet(sheetName);
  for (const line of headerLines) ws.addRow([line]).commit();
  ws.addRow([]).commit();
  ws.addRow(columns).commit();
  for (const r of rows) ws.addRow(columns.map(c => r[c])).commit();
  await ws.commit();
  await wb.commit();
}

async function buildReport(opts) {
  const { type, format, fromDate, toDate } = opts;
  if (!['summary', 'detail'].includes(type)) { const e = new Error('type must be summary|detail'); e.status = 400; throw e; }
  if (!['csv', 'xlsx'].includes(format))      { const e = new Error('format must be csv|xlsx');    e.status = 400; throw e; }

  const from = parseMDY(fromDate, false);
  const to   = parseMDY(toDate, true);
  if (!from || !to) { const e = new Error('fromDate and toDate required (MM/DD/YYYY)'); e.status = 400; throw e; }
  if (from > to)    { const e = new Error('fromDate must be <= toDate'); e.status = 400; throw e; }

  const headerLines = [
    `Accounting Period: ${formatMDY(from)} - ${formatMDY(to)}`,
    `Report Type: ${type === 'summary' ? 'Financial Summary' : 'Detailed Ledger'}`,
    `Generated: ${formatMDY(new Date())}`
  ];

  const columns = type === 'summary'
    ? ['merchant_id', 'payments', 'gross', 'fees', 'refunds', 'net']
    : ['id', 'payment_id', 'account', 'debit', 'credit', 'currency', 'occurred_at', 'memo'];

  const rows = type === 'summary' ? await fetchSummary(from, to) : await fetchDetail(from, to);

  const filename = `reconciliation_${type}_${formatMDY(from).replace(/\//g,'-')}_to_${formatMDY(to).replace(/\//g,'-')}.${format}`;
  const mime = format === 'csv'
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const out = new PassThrough();
  if (format === 'csv') {
    writeCsvToStream(out, headerLines, columns, rows);
  } else {
    writeXlsxToStream(out, headerLines, columns, rows, type === 'summary' ? 'Summary' : 'Ledger')
      .catch(err => out.destroy(err));
  }

  return { stream: out, filename, mime, rowCount: rows.length };
}

module.exports = { buildReport, formatMDY, parseMDY };
