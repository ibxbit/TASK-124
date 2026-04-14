'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateExport, formatMDY, parseMDY, buildHeaderLines, MAX_ROWS
} = require('../backend/src/services/exportValidation');

// ─── formatMDY / parseMDY ───────────────────────────────────────────────────

test('formatMDY produces MM/DD/YYYY with zero-padded month and day', () => {
  const d = new Date(2026, 0, 5);           // Jan 5 2026
  assert.equal(formatMDY(d), '01/05/2026');
});

test('formatMDY zero-pads December correctly', () => {
  assert.equal(formatMDY(new Date(2026, 11, 31)), '12/31/2026');
});

test('parseMDY accepts MM/DD/YYYY strings', () => {
  const d = parseMDY('04/13/2026');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 3);            // April (0-indexed)
  assert.equal(d.getDate(), 13);
  assert.equal(d.getHours(), 0);
});

test('parseMDY(endOfDay=true) sets 23:59:59.999', () => {
  const d = parseMDY('04/13/2026', true);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
});

test('parseMDY throws on missing value', () => {
  assert.throws(() => parseMDY(''), /Date required/);
  assert.throws(() => parseMDY(null), /Date required/);
});

test('parseMDY throws on malformed input', () => {
  assert.throws(() => parseMDY('not-a-date'), /Invalid date/);
});

// ─── buildHeaderLines ───────────────────────────────────────────────────────

test('buildHeaderLines always includes "Accounting Period" in MM/DD/YYYY', () => {
  const lines = buildHeaderLines({
    from: new Date(2026, 0, 1),
    to:   new Date(2026, 0, 31)
  });
  assert.equal(lines[0], 'Accounting Period: 01/01/2026 - 01/31/2026');
  assert.match(lines.find(l => l.startsWith('Generated:')), /^Generated: \d{2}\/\d{2}\/\d{4}$/);
});

test('buildHeaderLines embeds optional report type and row count', () => {
  const lines = buildHeaderLines(
    { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) },
    { reportType: 'Analytics Export', rowCount: 150 }
  );
  assert.ok(lines.includes('Report Type: Analytics Export'));
  assert.ok(lines.includes('Row Count: 150'));
});

// ─── validateExport ─────────────────────────────────────────────────────────

function definitionWithPeriod(from = '01/01/2026', to = '01/31/2026') {
  return { filters: { dateFrom: from, dateTo: to } };
}

test('validateExport rejects unknown format', async () => {
  await assert.rejects(
    validateExport(definitionWithPeriod(), 'pdf', { counter: async () => 0 }),
    /format must be one of/
  );
});

test('validateExport rejects missing accounting period', async () => {
  await assert.rejects(
    validateExport({ filters: {} }, 'csv', { counter: async () => 0 }),
    /Accounting period required/
  );
});

test('validateExport rejects inverted range', async () => {
  await assert.rejects(
    validateExport(definitionWithPeriod('02/01/2026', '01/01/2026'), 'csv',
      { counter: async () => 0 }),
    /dateFrom must be <= dateTo/
  );
});

test('validateExport rejects malformed date', async () => {
  await assert.rejects(
    validateExport({ filters: { dateFrom: 'xx', dateTo: '01/31/2026' } },
      'csv', { counter: async () => 0 }),
    /Invalid date/
  );
});

test('validateExport passes at exactly MAX_ROWS', async () => {
  const result = await validateExport(definitionWithPeriod(), 'csv', {
    counter: async () => MAX_ROWS
  });
  assert.equal(result.rowCount, MAX_ROWS);
  assert.equal(result.format, 'csv');
  assert.ok(result.headerLines[0].startsWith('Accounting Period:'));
});

test('validateExport throws when one row over MAX_ROWS', async () => {
  await assert.rejects(
    validateExport(definitionWithPeriod(), 'csv', { counter: async () => MAX_ROWS + 1 }),
    (err) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'EXPORT_ROW_LIMIT_EXCEEDED');
      assert.equal(err.details.rowCount, MAX_ROWS + 1);
      assert.equal(err.details.max, MAX_ROWS);
      return /exceeds the 200000-row maximum/.test(err.message);
    }
  );
});

test('validateExport throws when counter returns negative', async () => {
  await assert.rejects(
    validateExport(definitionWithPeriod(), 'csv', { counter: async () => -1 }),
    /invalid value/
  );
});

test('validateExport returns headerLines that include the period header', async () => {
  const r = await validateExport(definitionWithPeriod('03/01/2026', '03/31/2026'), 'xlsx',
    { counter: async () => 42 });
  assert.equal(r.headerLines[0], 'Accounting Period: 03/01/2026 - 03/31/2026');
  assert.ok(r.headerLines.some(l => l === 'Row Count: 42'));
});
