'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeGrowth, severityFor, WARN_GROWTH, CRITICAL_GROWTH } = require('../backend/src/services/memoryService');

// ─── computeGrowth ──────────────────────────────────────────────────────────

test('computeGrowth: 100→120 = 0.20 (20%)', () => {
  assert.equal(computeGrowth(100, 120), 0.20);
});

test('computeGrowth: 100→200 = 1.00 (100%)', () => {
  assert.equal(computeGrowth(100, 200), 1.00);
});

test('computeGrowth: baseline 0 → returns 0', () => {
  assert.equal(computeGrowth(0, 999), 0);
});

test('computeGrowth: null baseline → returns 0', () => {
  assert.equal(computeGrowth(null, 999), 0);
});

test('computeGrowth: negative baseline → returns 0', () => {
  assert.equal(computeGrowth(-5, 999), 0);
});

test('computeGrowth: no change → 0', () => {
  assert.equal(computeGrowth(100, 100), 0);
});

test('computeGrowth: shrink → negative', () => {
  assert.ok(computeGrowth(100, 80) < 0);
});

// ─── severityFor ────────────────────────────────────────────────────────────

test('severityFor: below warn → null', () => {
  assert.equal(severityFor(0.10), null);
  assert.equal(severityFor(0), null);
  assert.equal(severityFor(WARN_GROWTH), null); // exactly at, > not >=
});

test('severityFor: above warn, below critical → "warning"', () => {
  assert.equal(severityFor(0.21), 'warning');
  assert.equal(severityFor(0.49), 'warning');
});

test('severityFor: at or above critical → "critical"', () => {
  assert.equal(severityFor(CRITICAL_GROWTH), 'critical');
  assert.equal(severityFor(1.0), 'critical');
});

// ─── Constants sanity ───────────────────────────────────────────────────────

test('WARN_GROWTH is 0.20 and CRITICAL_GROWTH is 0.50', () => {
  assert.equal(WARN_GROWTH, 0.20);
  assert.equal(CRITICAL_GROWTH, 0.50);
});
