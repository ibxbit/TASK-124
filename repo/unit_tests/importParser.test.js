'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// importParser.js exports parseBuffer, but we need inner funcs for thorough
// unit tests.  We re-implement the module-loading trick: read source, extract
// exported + private functions by eval-ing the module body with a fake require.
// Simpler approach: just require the module and test the public API which
// exercises all inner functions.

const { parseBuffer } = require('../backend/src/services/importParser');

// ─── splitCsvLine / parseCsvBuffer via parseBuffer('csv',…) ─────────────────

test('parseBuffer csv: parses a simple two-column CSV', async () => {
  const buf = Buffer.from('transaction_id,amount\nTX-1,500\nTX-2,200');
  const rows = await parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].externalId, 'TX-1');
  assert.equal(rows[0].grossAmount, 500);
  assert.equal(rows[0].provider, 'wechat_pay');
});

test('parseBuffer csv: handles BOM-prefixed UTF-8', async () => {
  const bom = '\uFEFF';
  const buf = Buffer.from(bom + 'reference,amount,beneficiary,memo,posted_at\nREF-1,100,B1,M1,2026-01-01');
  const rows = await parseBuffer(buf, 'csv', 'bank');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'REF-1');
  assert.equal(rows[0].provider, 'bank');
});

test('parseBuffer csv: quoted fields with embedded commas and double-quotes', async () => {
  const buf = Buffer.from(
    'transaction_id,amount,merchant_id,order_id,type,time\n' +
    '"TX-""QUOTED""",1000,"M,1",O1,full,2026-01-01\n'
  );
  const rows = await parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'TX-"QUOTED"');
  assert.equal(rows[0].grossAmount, 1000);
});

test('parseBuffer csv: empty buffer returns empty array', async () => {
  const rows = await parseBuffer(Buffer.from(''), 'csv', 'bank');
  assert.deepEqual(rows, []);
});

test('parseBuffer csv: header-only returns empty array', async () => {
  const rows = await parseBuffer(Buffer.from('reference,amount'), 'csv', 'bank');
  assert.deepEqual(rows, []);
});

test('parseBuffer csv: rows with missing externalId are filtered out', async () => {
  const buf = Buffer.from(
    'transaction_id,amount,merchant_id,order_id,type,time\n' +
    ',100,M1,O1,full,2026-01-01\n' +
    'TX-OK,200,M2,O2,full,2026-01-01'
  );
  const rows = await parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'TX-OK');
});

test('parseBuffer csv: rows with NaN grossAmount are filtered out', async () => {
  const buf = Buffer.from(
    'reference,amount,beneficiary,memo,posted_at\n' +
    'R1,notanumber,B1,M1,2026-01-01\n' +
    'R2,300,B2,M2,2026-01-02'
  );
  const rows = await parseBuffer(buf, 'csv', 'bank');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'R2');
});

// ─── mapWechatState via normalizeWechat ─────────────────────────────────────

test('wechat normalizer maps "pre_auth" type correctly', async () => {
  const buf = Buffer.from(
    'transaction_id,amount,merchant_id,order_id,type,time\n' +
    'TX-PA,100,M1,O1,pre_authorization,2026-01-01\n' +
    'TX-D,200,M1,O1,deposit,2026-01-01\n' +
    'TX-F,300,M1,O1,purchase,2026-01-01'
  );
  const rows = await parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows[0].state, 'pre_auth');
  assert.equal(rows[1].state, 'deposit');
  assert.equal(rows[2].state, 'full');
});

test('wechat normalizer handles capitalized header names', async () => {
  const buf = Buffer.from(
    'Transaction ID,Amount,Merchant ID,Order ID,Type,Time\n' +
    'TX-CAP,750,MC1,OC1,Full,2026-01-01'
  );
  const rows = await parseBuffer(buf, 'csv', 'wechat_pay');
  assert.equal(rows[0].externalId, 'TX-CAP');
  assert.equal(rows[0].grossAmount, 750);
});

// ─── normalizeBank ──────────────────────────────────────────────────────────

test('bank normalizer sets provider to "bank" and state to "full"', async () => {
  const buf = Buffer.from(
    'Reference,Amount,Beneficiary,Memo,Posted At\n' +
    'BNK-1,2500,MERCH1,Payment for invoice,2026-02-15'
  );
  const rows = await parseBuffer(buf, 'csv', 'bank');
  assert.equal(rows[0].provider, 'bank');
  assert.equal(rows[0].state, 'full');
  assert.equal(rows[0].orderId, 'Payment for invoice');
  assert.ok(rows[0].occurredAt instanceof Date);
});

test('bank normalizer handles lowercase header names', async () => {
  const buf = Buffer.from(
    'reference,amount,beneficiary,memo,posted_at\n' +
    'bnk-2,100,B2,memo2,2026-03-01'
  );
  const rows = await parseBuffer(buf, 'csv', 'bank');
  assert.equal(rows[0].externalId, 'bnk-2');
});

// ─── CRLF and multi-line ────────────────────────────────────────────────────

test('parseBuffer csv: handles CRLF line endings', async () => {
  const buf = Buffer.from('reference,amount,beneficiary,memo,posted_at\r\nR1,100,B1,M1,2026-01-01\r\nR2,200,B2,M2,2026-01-02');
  const rows = await parseBuffer(buf, 'csv', 'bank');
  assert.equal(rows.length, 2);
});
