'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { twoSidedZTest, normCdf } = require('../src/services/stats');

// ─── Normal CDF ─────────────────────────────────────────────────────────────

test('normCdf(0) ≈ 0.5 (symmetry)', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
});

test('normCdf(1.96) ≈ 0.975 (95th percentile)', () => {
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 0.001);
});

test('normCdf(-1.96) ≈ 0.025 (left tail)', () => {
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 0.001);
});

test('normCdf(3.0) is close to 1.0', () => {
  assert.ok(normCdf(3.0) > 0.998);
});

test('normCdf(-3.0) is close to 0.0', () => {
  assert.ok(normCdf(-3.0) < 0.002);
});

// ─── z-test: no data ────────────────────────────────────────────────────────

test('zero trials returns neutral result', () => {
  const r = twoSidedZTest(0, 0, 0, 0);
  assert.equal(r.zScore, 0);
  assert.equal(r.pValue, 1);
  assert.equal(r.significant, false);
});

test('one empty bucket returns neutral', () => {
  const r = twoSidedZTest(50, 100, 0, 0);
  assert.equal(r.significant, false);
  assert.equal(r.pValue, 1);
});

// ─── z-test: identical proportions ──────────────────────────────────────────

test('identical proportions ⇒ zScore=0, not significant', () => {
  const r = twoSidedZTest(50, 100, 50, 100);
  assert.ok(Math.abs(r.zScore) < 1e-9);
  assert.ok(r.pValue > 0.99);
  assert.equal(r.significant, false);
});

// ─── z-test: clearly different proportions ──────────────────────────────────

test('50% vs 10% with n=1000 ⇒ significant at α=0.05', () => {
  const r = twoSidedZTest(500, 1000, 100, 1000, 0.05);
  assert.equal(r.significant, true);
  assert.ok(r.pValue < 0.001);
  assert.ok(r.zScore > 10);
});

test('large sample, small difference (50.1% vs 49.9%) ⇒ not significant at n=100', () => {
  const r = twoSidedZTest(50, 100, 49, 100, 0.05);
  assert.equal(r.significant, false);
  assert.ok(r.pValue > 0.05);
});

// ─── z-test: alpha sensitivity ──────────────────────────────────────────────

test('borderline result is significant at α=0.10 but not at α=0.01', () => {
  // 264/500 = 52.8% vs 236/500 = 47.2% → z ≈ 1.77, p ≈ 0.077
  const r10 = twoSidedZTest(264, 500, 236, 500, 0.10);
  const r01 = twoSidedZTest(264, 500, 236, 500, 0.01);
  assert.equal(r10.significant, true);
  assert.equal(r01.significant, false);
  // same p-value regardless of alpha
  assert.equal(r10.pValue, r01.pValue);
});

// ─── z-test: all succeed ────────────────────────────────────────────────────

test('100% vs 100% ⇒ se=0, not significant', () => {
  const r = twoSidedZTest(100, 100, 200, 200);
  assert.equal(r.zScore, 0);
  assert.equal(r.significant, false);
});
