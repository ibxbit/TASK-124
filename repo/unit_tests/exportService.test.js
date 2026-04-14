'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { toCsv, csvEscape, COLUMNS } =
  require('../backend/src/services/exportFormat');
const { buildHeaderLines } =
  require('../backend/src/services/exportValidation');

const PERIOD = { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) };
const HEADER = buildHeaderLines(PERIOD, { reportType: 'Analytics Export', rowCount: 2 });

const SAMPLE_ROWS = [
  {
    id: 1, occurred_at: '2026-01-05T00:00:00Z', provider: 'stripe', sku: 'SKU-1',
    experiment_bucket: 'A', amount: 120.50, currency: 'USD',
    refund_reason: null, order_id: 'ORD-1'
  },
  {
    id: 2, occurred_at: '2026-01-10T00:00:00Z', provider: 'adyen', sku: 'SKU-2',
    experiment_bucket: 'B', amount: 89.00, currency: 'USD',
    refund_reason: 'customer', order_id: 'ORD-2'
  }
];

// ─── csvEscape ──────────────────────────────────────────────────────────────

test('csvEscape wraps values containing commas in quotes', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
});

test('csvEscape doubles embedded quotes', () => {
  assert.equal(csvEscape('he said "hi"'), '"he said ""hi"""');
});

test('csvEscape handles null/undefined as empty', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

// ─── toCsv (header format) ──────────────────────────────────────────────────

test('toCsv places the Accounting Period header on the first line', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  const firstLine = csv.split('\r\n')[0];
  assert.equal(firstLine, 'Accounting Period: 01/01/2026 - 01/31/2026');
});

test('toCsv emits MM/DD/YYYY dates throughout the header block', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  const headerBlock = csv.split('\r\n\r\n')[0];
  for (const line of headerBlock.split('\r\n')) {
    const found = line.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);
    if (found) {
      for (const date of found) {
        assert.match(date, /^\d{2}\/\d{2}\/\d{4}$/,
          `Header date "${date}" is not zero-padded MM/DD/YYYY`);
      }
    }
  }
});

test('toCsv leaves a blank line between header block and data table', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  assert.ok(csv.includes('\r\n\r\n'),
    'CSV must separate the header block from data with a blank line');
});

// ─── toCsv (data consistency) ───────────────────────────────────────────────

test('toCsv emits one column-header row followed by one row per record', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  const [, table] = csv.split('\r\n\r\n');
  const lines = table.trimEnd().split('\r\n');
  assert.equal(lines.length, 1 + SAMPLE_ROWS.length);
  assert.equal(lines[0], COLUMNS.join(','));
});

test('every data row has the same column count as the header', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  const [, table] = csv.split('\r\n\r\n');
  const lines = table.trimEnd().split('\r\n');
  const headerCount = lines[0].split(',').length;
  for (const line of lines.slice(1)) {
    // Use a naive split; values in SAMPLE_ROWS don't contain embedded commas
    assert.equal(line.split(',').length, headerCount,
      `Row "${line}" has wrong column count`);
  }
});

test('data round-trips: every value in SAMPLE_ROWS appears in its CSV line', () => {
  const csv = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
  const [, table] = csv.split('\r\n\r\n');
  const dataLines = table.trimEnd().split('\r\n').slice(1);
  for (let i = 0; i < SAMPLE_ROWS.length; i++) {
    const row = SAMPLE_ROWS[i];
    const line = dataLines[i];
    for (const col of COLUMNS) {
      const v = row[col];
      if (v == null) continue;
      assert.ok(line.includes(String(v)),
        `expected "${v}" (${col}) in row ${i}: "${line}"`);
    }
  }
});

test('null values serialize to empty fields (not the literal "null")', () => {
  const csv = toCsv(HEADER, COLUMNS, [SAMPLE_ROWS[0]]);
  const [, table] = csv.split('\r\n\r\n');
  const dataLine = table.trimEnd().split('\r\n')[1];
  // refund_reason is null on SAMPLE_ROWS[0]; expect empty between commas
  const cells = dataLine.split(',');
  const refundIdx = COLUMNS.indexOf('refund_reason');
  assert.equal(cells[refundIdx], '');
});

// ─── File round-trip (disk output mirrors in-memory formatter) ──────────────

test('toCsv output persists to disk byte-for-byte', async () => {
  const tmp = path.join(os.tmpdir(), `export_test_${Date.now()}.csv`);
  try {
    const expected = toCsv(HEADER, COLUMNS, SAMPLE_ROWS);
    fs.writeFileSync(tmp, expected, 'utf8');
    const contents = fs.readFileSync(tmp, 'utf8');
    assert.equal(contents.split('\r\n')[0], 'Accounting Period: 01/01/2026 - 01/31/2026');
    assert.ok(contents.includes('stripe'));
    assert.ok(contents.includes('adyen'));
    assert.equal(contents, expected);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});
