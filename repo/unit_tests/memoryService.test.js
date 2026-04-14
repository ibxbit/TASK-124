'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeGrowth, severityFor, WARN_GROWTH, CRITICAL_GROWTH
} = require('../backend/src/services/memoryService');

// ─── computeGrowth ──────────────────────────────────────────────────────────

test('computeGrowth returns 0 when baseline is 0 or null', () => {
  assert.equal(computeGrowth(0, 100), 0);
  assert.equal(computeGrowth(null, 100), 0);
});

test('computeGrowth returns the expected ratio', () => {
  assert.equal(computeGrowth(100, 120), 0.2);
  assert.equal(computeGrowth(1000, 1234), 0.234);
});

test('computeGrowth returns a negative ratio when memory shrinks', () => {
  assert.ok(computeGrowth(200, 150) < 0);
});

// ─── severityFor / thresholds ───────────────────────────────────────────────

test('growth of exactly 20% does NOT trigger warning (threshold is strictly >)', () => {
  assert.equal(severityFor(0.20), null);
});

test('growth just above 20% triggers a warning', () => {
  assert.equal(severityFor(0.2001), 'warning');
});

test('growth of 50% triggers critical', () => {
  assert.equal(severityFor(0.50), 'critical');
});

test('growth below warn threshold returns null', () => {
  assert.equal(severityFor(0.05), null);
  assert.equal(severityFor(0),    null);
  assert.equal(severityFor(-0.1), null);
});

test('thresholds match documented values (warn=20%, critical=50%)', () => {
  assert.equal(WARN_GROWTH, 0.20);
  assert.equal(CRITICAL_GROWTH, 0.50);
});

test('20% growth is the documented warning threshold', () => {
  // The spec says "Trigger warning if growth >20%". Confirm boundary behavior.
  assert.equal(severityFor(WARN_GROWTH), null);
  assert.equal(severityFor(WARN_GROWTH + 1e-6), 'warning');
});
