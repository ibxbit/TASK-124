'use strict';

// Pre-generation validator for every export.
//
// Contract:
//   - format MUST be 'csv' or 'xlsx'
//   - definition MUST carry filters.dateFrom + filters.dateTo (accounting period)
//   - both dates MUST parse as MM/DD/YYYY (or ISO); from <= to
//   - actual row count (pre-counted) MUST be <= MAX_ROWS (strict, not truncating)
//
// Exposes:
//   formatMDY(date)        → "MM/DD/YYYY"
//   parseMDY(value, endOfDay=false) → Date (throws on invalid)
//   buildHeaderLines(period, extra?)  → string[] rendered at top of every export
//   validateExport(definition, format, { counter? }) → { format, period, rowCount, headerLines }

const { buildSelectQuery } = require('./queryBuilder');
const { getDb } = require('../db/pool');

const FORMATS  = new Set(['csv', 'xlsx']);
const MAX_ROWS = 200_000;

function pad2(n) { return String(n).padStart(2, '0'); }

function formatMDY(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) throw new Error('Invalid date');
  return `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}/${dt.getFullYear()}`;
}

function parseMDY(value, endOfDay = false) {
  if (value == null || value === '') {
    const e = new Error('Date required (expected MM/DD/YYYY)'); e.status = 400; throw e;
  }
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value));
  let dt;
  if (mdy) dt = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  else     dt = new Date(value);
  if (isNaN(dt)) {
    const e = new Error(`Invalid date "${value}"; expected MM/DD/YYYY`);
    e.status = 400; throw e;
  }
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else          dt.setHours(0, 0, 0, 0);
  return dt;
}

function buildHeaderLines(period, extra = {}) {
  const { from, to } = period;
  const lines = [
    `Accounting Period: ${formatMDY(from)} - ${formatMDY(to)}`,
    `Generated: ${formatMDY(new Date())}`
  ];
  if (extra.reportType) lines.splice(1, 0, `Report Type: ${extra.reportType}`);
  if (extra.rowCount != null) lines.push(`Row Count: ${extra.rowCount}`);
  return lines;
}

// Default row counter runs a COUNT(*) against the transactions fact table using
// the same filters the definition would use for data extraction.
async function defaultCounter(definition) {
  const { countSql, countParams } = buildSelectQuery(definition);
  const { rows } = await getDb().query(countSql, countParams);
  return Number(rows[0].total);
}

async function validateExport(definition, format, opts = {}) {
  const errors = [];

  if (!format || !FORMATS.has(format)) {
    errors.push(`format must be one of: ${[...FORMATS].join(', ')}`);
  }
  if (!definition || typeof definition !== 'object') {
    errors.push('definition required');
  }

  let period = null;
  if (definition && definition.filters && typeof definition.filters === 'object') {
    const { dateFrom, dateTo } = definition.filters;
    if (!dateFrom || !dateTo) {
      errors.push('Accounting period required: filters.dateFrom and filters.dateTo (MM/DD/YYYY)');
    } else {
      try {
        const from = parseMDY(dateFrom, false);
        const to   = parseMDY(dateTo,   true);
        if (from > to) errors.push('dateFrom must be <= dateTo');
        else period = { from, to };
      } catch (err) { errors.push(err.message); }
    }
  } else if (!errors.length) {
    errors.push('definition.filters with dateFrom and dateTo required');
  }

  if (errors.length) {
    const e = new Error(errors.join('; '));
    e.status = 400;
    e.details = errors;
    throw e;
  }

  // Strict row-limit enforcement (pre-count, no silent truncation).
  const counter = opts.counter || defaultCounter;
  const rowCount = Number(await counter(definition));
  if (!Number.isFinite(rowCount) || rowCount < 0) {
    const e = new Error('Row counter returned invalid value'); e.status = 500; throw e;
  }
  if (rowCount > MAX_ROWS) {
    const e = new Error(
      `Export refused: ${rowCount} rows exceeds the ${MAX_ROWS}-row maximum. ` +
      `Narrow the accounting period or apply additional filters.`);
    e.status = 413;
    e.code = 'EXPORT_ROW_LIMIT_EXCEEDED';
    e.details = { rowCount, max: MAX_ROWS };
    throw e;
  }

  const headerLines = buildHeaderLines(period, {
    reportType: opts.reportType || 'Analytics Export',
    rowCount
  });

  return { format, period, rowCount, headerLines };
}

module.exports = {
  validateExport, formatMDY, parseMDY, buildHeaderLines,
  MAX_ROWS, FORMATS
};
