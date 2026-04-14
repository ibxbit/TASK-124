'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let maskLast4, formatLast4, maskCardToken;

test('load mask module', async () => {
  const mod = await import('../frontend/src/lib/mask.js');
  maskLast4 = mod.maskLast4;
  formatLast4 = mod.formatLast4;
  maskCardToken = mod.maskCardToken;
});

test('maskLast4 masks all but last 4 characters', () => {
  assert.equal(maskLast4('1234567890'), '••••••7890');
});

test('maskLast4 pads short strings with pad character', () => {
  assert.equal(maskLast4('ab'), '••ab');
  assert.equal(maskLast4('1'), '•••1');
});

test('maskLast4 handles 4-char input without padding extra', () => {
  assert.equal(maskLast4('1234'), '1234');
});

test('maskLast4 handles null/undefined as empty', () => {
  assert.equal(maskLast4(null), '');
  assert.equal(maskLast4(undefined), '');
});

test('maskLast4 accepts custom pad character', () => {
  assert.equal(maskLast4('1234567890', '*'), '******7890');
});

test('formatLast4 adds prefix padding to a last-4 value', () => {
  assert.equal(formatLast4('7890', 8), '••••••••7890');
});

test('formatLast4 handles null/empty as empty string', () => {
  assert.equal(formatLast4(null), '');
  assert.equal(formatLast4(''), '');
});

test('financial amounts get masked: "1250.50" shows last 4 chars masked', () => {
  assert.equal(maskLast4('1250.50'), '••••0.50');
});

// ── maskCardToken tests ────────────────────────────────────────────────────

test('maskCardToken formats as grouped card-style mask with last 4 visible', () => {
  assert.equal(maskCardToken('tok-123456'), '•••• •••• •••• 3456');
});

test('maskCardToken handles short values (≤4 chars) without masking', () => {
  assert.equal(maskCardToken('ab'), 'ab');
  assert.equal(maskCardToken('1234'), '1234');
});

test('maskCardToken handles null/undefined as empty string', () => {
  assert.equal(maskCardToken(null), '');
  assert.equal(maskCardToken(undefined), '');
});

test('maskCardToken masks API key style strings', () => {
  assert.equal(maskCardToken('sk-live-abc123xyz789'), '•••• •••• •••• z789');
});

// ── UI integration: settlement amounts masked by default ────────────────────

test('settlement gross/fees/net amounts should be masked via maskLast4', () => {
  const gross = '15234.50';
  const fees = '1923.10';
  const net = '13311.40';
  assert.equal(maskLast4(gross), '••••4.50');
  assert.equal(maskLast4(fees), '••••3.10');
  assert.equal(maskLast4(net), '••••1.40');
});

test('refund amounts masked via maskLast4', () => {
  assert.equal(maskLast4('500.00'), '••••0.00');
});

test('credential last4 display via formatLast4', () => {
  assert.equal(formatLast4('5678'), '••••••••5678');
  assert.equal(formatLast4('9012', 4), '••••9012');
});
