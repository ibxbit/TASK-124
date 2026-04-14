'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { stableHash, assignBucket } = require('../src/services/bucketing');

// ─── determinism ────────────────────────────────────────────────────────────

test('stableHash is deterministic for the same (user, exp, version)', () => {
  const h1 = stableHash('u1', 42, 1);
  const h2 = stableHash('u1', 42, 1);
  assert.equal(h1, h2);
});

test('stableHash changes when user changes', () => {
  assert.notEqual(stableHash('u1', 42, 1), stableHash('u2', 42, 1));
});

test('stableHash changes when version changes', () => {
  assert.notEqual(stableHash('u1', 42, 1), stableHash('u1', 42, 2));
});

test('stableHash returns value in [0, 1)', () => {
  for (let i = 0; i < 100; i++) {
    const h = stableHash(`user_${i}`, 1, 1);
    assert.ok(h >= 0 && h < 1, `Hash ${h} outside [0,1)`);
  }
});

// ─── bucket assignment ──────────────────────────────────────────────────────

test('50/50 split assigns to one of two buckets', () => {
  const b = assignBucket('u1', 1, 1, { A: 50, B: 50 });
  assert.ok(['A', 'B'].includes(b));
});

test('assignment is deterministic', () => {
  const b1 = assignBucket('u1', 1, 1, { A: 50, B: 50 });
  const b2 = assignBucket('u1', 1, 1, { A: 50, B: 50 });
  assert.equal(b1, b2);
});

test('100/0 split always assigns to the only bucket with traffic', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(assignBucket(`u${i}`, 1, 1, { A: 100, B: 0 }), 'A');
  }
});

test('three-way split covers all buckets over many users', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    seen.add(assignBucket(`user${i}`, 10, 1, { A: 33, B: 33, C: 34 }));
  }
  assert.deepEqual([...seen].sort(), ['A', 'B', 'C']);
});

test('traffic_split summing to 0 throws', () => {
  assert.throws(
    () => assignBucket('u1', 1, 1, { A: 0, B: 0 }),
    /must sum to > 0/);
});

test('rough 50/50 distribution within statistical bounds', () => {
  let countA = 0;
  const N = 10_000;
  for (let i = 0; i < N; i++) {
    if (assignBucket(`usr${i}`, 1, 1, { A: 50, B: 50 }) === 'A') countA++;
  }
  const ratio = countA / N;
  assert.ok(ratio > 0.45 && ratio < 0.55,
    `ratio ${ratio} drifts too far from 0.50 for 50/50 split`);
});
