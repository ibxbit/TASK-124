'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeForHash, contentHash, decayScore,
  SCORE_HALF_LIFE_SEC, BLOCK_THRESHOLD, SIGNAL_WEIGHTS,
  DEVICE_BURST_THRESHOLD, DUPLICATE_WINDOW_SEC
} = require('../backend/src/services/spamService');

// ─── normalization & hashing ────────────────────────────────────────────────

test('normalizeForHash lower-cases, collapses whitespace, strips punctuation', () => {
  assert.equal(normalizeForHash('Hello,   WORLD!'), 'hello world');
  assert.equal(normalizeForHash('  a   b\tc\n'),     'a b c');
});

test('normalizeForHash returns empty string for nullish/whitespace-only input', () => {
  assert.equal(normalizeForHash(null), '');
  assert.equal(normalizeForHash(''), '');
  assert.equal(normalizeForHash('   \t\n'), '');
});

test('contentHash produces identical hashes for punctuation/whitespace variants', () => {
  const a = contentHash('Buy now!!! www.example.com');
  const b = contentHash('buy now www example com');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('contentHash returns null for meaningless input', () => {
  assert.equal(contentHash(''), null);
  assert.equal(contentHash('   '), null);
  assert.equal(contentHash(null), null);
});

test('contentHash differs for semantically different content', () => {
  const a = contentHash('click here to win');
  const b = contentHash('not the same message');
  assert.notEqual(a, b);
});

// ─── exponential decay ──────────────────────────────────────────────────────

test('decayScore returns 0 when previous is 0/null', () => {
  assert.equal(decayScore(0, 100), 0);
  assert.equal(decayScore(null, 100), 0);
});

test('decayScore halves at the half-life', () => {
  const decayed = decayScore(100, SCORE_HALF_LIFE_SEC);
  assert.ok(Math.abs(decayed - 50) < 1e-6, `expected ~50, got ${decayed}`);
});

test('decayScore reaches 1/4 after two half-lives', () => {
  const decayed = decayScore(100, SCORE_HALF_LIFE_SEC * 2);
  assert.ok(Math.abs(decayed - 25) < 1e-6, `expected ~25, got ${decayed}`);
});

test('decayScore preserves score at elapsed=0', () => {
  assert.equal(decayScore(77.7, 0), 77.7);
});

// ─── spam scoring model ────────────────────────────────────────────────────

test('SIGNAL_WEIGHTS covers all documented signals and ok=0', () => {
  for (const k of ['duplicate_content','rate_exceeded','device_burst',
                   'sensitive_word','blacklisted_user','ok']) {
    assert.ok(SIGNAL_WEIGHTS[k] != null, `missing weight for ${k}`);
  }
  assert.equal(SIGNAL_WEIGHTS.ok, 0);
});

test('three rate_exceeded signals keep a user under the block threshold', () => {
  const score = SIGNAL_WEIGHTS.rate_exceeded * 3;
  assert.ok(score < BLOCK_THRESHOLD, `3× rate = ${score} should be < ${BLOCK_THRESHOLD}`);
});

test('a single blacklisted_user signal exceeds the block threshold', () => {
  assert.ok(SIGNAL_WEIGHTS.blacklisted_user >= BLOCK_THRESHOLD);
});

test('duplicate + device_burst + rate_exceeded combined ≥ block threshold', () => {
  const combined = SIGNAL_WEIGHTS.duplicate_content
                 + SIGNAL_WEIGHTS.device_burst
                 + SIGNAL_WEIGHTS.rate_exceeded * 4;
  // 30 + 20 + 60 = 110 > 100
  assert.ok(combined >= BLOCK_THRESHOLD,
    `combined score ${combined} should trip threshold ${BLOCK_THRESHOLD}`);
});

// ─── documented constants ──────────────────────────────────────────────────

test('DEVICE_BURST_THRESHOLD matches spec (>10 actions in 5 min)', () => {
  assert.equal(DEVICE_BURST_THRESHOLD, 10);
});

test('DUPLICATE_WINDOW_SEC matches spec (24h duplicate window)', () => {
  assert.equal(DUPLICATE_WINDOW_SEC, 24 * 60 * 60);
});

test('BLOCK_THRESHOLD is documented 100', () => {
  assert.equal(BLOCK_THRESHOLD, 100);
});
