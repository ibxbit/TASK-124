'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalJson, checksumOf, verify } =
  require('../backend/src/services/checkpointIntegrity');

test('canonicalJson sorts keys so checksums are order-independent', () => {
  const a = { z: 1, a: 2, m: { y: 3, x: 4 } };
  const b = { m: { x: 4, y: 3 }, a: 2, z: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(checksumOf(a), checksumOf(b));
});

test('canonicalJson preserves array order (semantically significant)', () => {
  const a = { list: [1, 2, 3] };
  const b = { list: [3, 2, 1] };
  assert.notEqual(checksumOf(a), checksumOf(b));
});

test('checksumOf produces a 64-char hex digest', () => {
  const h = checksumOf({ hello: 'world' });
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('verify() returns ok when checksum matches', () => {
  const payload = { bucket: 'A', count: 42 };
  const row = { payload, checksum: checksumOf(payload) };
  assert.deepEqual(verify(row), { ok: true });
});

test('verify() flags checksum_mismatch when payload is tampered', () => {
  const original = { amount: 100 };
  const row = {
    payload: { amount: 100 },
    checksum: checksumOf(original)
  };
  // Simulate in-flight tampering
  row.payload.amount = 999;
  const v = verify(row);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'checksum_mismatch');
  assert.ok(v.expected !== v.actual);
});

test('verify() flags missing_checksum when row lacks the field', () => {
  const v = verify({ payload: { x: 1 } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'missing_checksum');
});

test('verify() flags not_found for null row', () => {
  assert.deepEqual(verify(null), { ok: false, reason: 'not_found' });
});

test('checksum changes if nested value changes', () => {
  const a = { nested: { count: 1 } };
  const b = { nested: { count: 2 } };
  assert.notEqual(checksumOf(a), checksumOf(b));
});

test('checksum unchanged if only whitespace / object-identity differs', () => {
  const a = { a: 1, b: 2 };
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(checksumOf(a), checksumOf(b));
});
