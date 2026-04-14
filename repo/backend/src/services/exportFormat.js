'use strict';

// Pure formatting primitives for exports. No DB, no ExcelJS — safe to import
// from tests without triggering heavy dependencies.

const COLUMNS = [
  'id', 'occurred_at', 'provider', 'sku', 'experiment_bucket',
  'amount', 'currency', 'refund_reason', 'order_id'
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headerLines, columns, rows) {
  const header = headerLines.map(csvEscape).join('\r\n');
  const table  = [columns.map(csvEscape).join(',')]
    .concat(rows.map(r => columns.map(c => csvEscape(r[c])).join(',')))
    .join('\r\n');
  return `${header}\r\n\r\n${table}\r\n`;
}

module.exports = { COLUMNS, csvEscape, toCsv };
