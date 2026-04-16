'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sha256, cmpVersions } = require('../backend/src/services/updateService');

// ─── sha256 ─────────────────────────────────────────────────────────────────

test('sha256: known input', () => {
  assert.equal(sha256('hello'), crypto.createHash('sha256').update('hello').digest('hex'));
});

test('sha256: Buffer input', () => {
  const buf = Buffer.from('world');
  assert.equal(sha256(buf), crypto.createHash('sha256').update(buf).digest('hex'));
});

test('sha256: empty string → deterministic hash', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

// ─── cmpVersions ────────────────────────────────────────────────────────────

test('cmpVersions: equal → 0', () => {
  assert.equal(cmpVersions('1.2.3', '1.2.3'), 0);
});

test('cmpVersions: major diff', () => {
  assert.ok(cmpVersions('2.0.0', '1.9.9') > 0);
  assert.ok(cmpVersions('1.0.0', '2.0.0') < 0);
});

test('cmpVersions: minor diff', () => {
  assert.ok(cmpVersions('1.2.0', '1.1.9') > 0);
});

test('cmpVersions: patch diff', () => {
  assert.ok(cmpVersions('1.0.2', '1.0.1') > 0);
});

test('cmpVersions: different segment counts', () => {
  assert.equal(cmpVersions('1.0', '1.0.0'), 0);
  assert.ok(cmpVersions('1.1', '1.0.9') > 0);
});

test('cmpVersions: large version numbers', () => {
  assert.ok(cmpVersions('10.0.0', '9.99.99') > 0);
});
