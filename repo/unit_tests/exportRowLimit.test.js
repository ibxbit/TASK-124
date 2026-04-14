'use strict';

// Dedicated row-limit suite. The hard cap is 200,000: exactly that many rows
// must succeed; a single row more must fail with HTTP 413 and a machine-readable
// error code. The validator uses an injected counter so these tests run with
// no database dependency.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateExport, MAX_ROWS } = require('../backend/src/services/exportValidation');

const DEF = { filters: { dateFrom: '01/01/2026', dateTo: '01/31/2026' } };

test('MAX_ROWS is exactly 200,000', () => {
  assert.equal(MAX_ROWS, 200_000);
});

test('at MAX_ROWS - 1 the export is allowed', async () => {
  const r = await validateExport(DEF, 'csv', { counter: async () => MAX_ROWS - 1 });
  assert.equal(r.rowCount, MAX_ROWS - 1);
});

test('at MAX_ROWS exactly the export is allowed', async () => {
  const r = await validateExport(DEF, 'csv', { counter: async () => MAX_ROWS });
  assert.equal(r.rowCount, MAX_ROWS);
});

test('at MAX_ROWS + 1 the export is refused with status 413', async () => {
  await assert.rejects(
    validateExport(DEF, 'csv', { counter: async () => MAX_ROWS + 1 }),
    (err) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'EXPORT_ROW_LIMIT_EXCEEDED');
      return true;
    }
  );
});

test('error payload carries observed + max row counts for operator messaging', async () => {
  try {
    await validateExport(DEF, 'csv', { counter: async () => 250_000 });
    assert.fail('validateExport should have thrown');
  } catch (err) {
    assert.equal(err.details.rowCount, 250_000);
    assert.equal(err.details.max, MAX_ROWS);
  }
});

test('xlsx format is subject to the same limit', async () => {
  await assert.rejects(
    validateExport(DEF, 'xlsx', { counter: async () => MAX_ROWS + 1 }),
    /exceeds the 200000-row maximum/
  );
});
