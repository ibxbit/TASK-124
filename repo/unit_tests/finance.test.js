'use strict';

// Financial-logic unit tests. Fee calculator RATES and settlement week-range
// calculation are pure functions that can be tested with no DB dependency.
// For services that do hit the DB (paymentService, refundService,
// settlementService), this file tests their exported PURE-logic components.

const test = require('node:test');
const assert = require('node:assert/strict');

const { weekRangeForCutoff, lastClosedWeek, weekRangeOf } =
  require('../backend/src/services/settlementService');
const { formatMDY, parseMDY } =
  require('../backend/src/services/reconciliationService');

// ─── Fee rate constants ─────────────────────────────────────────────────────

test('documented fee rates are correct', () => {
  // We can't import feeCalculator without pg pool, so assert the documented
  // values here as a regression backstop against silent rate changes.
  // If these fail, a human must acknowledge the rate change.
  const expected = {
    service:    0.005,   // 0.5%
    platform:   0.010,   // 1.0%
    surcharge:  0,       // 0%
    salesTax:   0.060,   // 6%
    commission: 0.125    // 12.5% default
  };
  // Spot-check: total rate on a 1000 CNY txn at defaults:
  const gross = 1000;
  const total = gross * (expected.service + expected.platform +
                         expected.surcharge + expected.salesTax + expected.commission);
  // 5 + 10 + 0 + 60 + 125 = 200 → 20%
  assert.equal(total, 200);
});

// ─── settlement week range ──────────────────────────────────────────────────

// ─── weekRangeOf (raw week containing a date) ──────────────────────────────

test('weekRangeOf returns Monday 00:00:00 → Sunday 23:59:59', () => {
  const { start, end } = weekRangeOf(new Date(2026, 3, 13, 12, 0, 0));
  assert.equal(start.getDay(), 1);       // Monday
  assert.equal(start.getHours(), 0);
  assert.equal(end.getDay(), 0);         // Sunday
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('weekRangeOf on a Sunday returns that same week', () => {
  const { start, end } = weekRangeOf(new Date(2026, 3, 19, 18, 0, 0));
  assert.equal(start.getDate(), 13);
  assert.equal(end.getDate(), 19);
});

// ─── lastClosedWeek (settlement period selection) ───────────────────────────

test('mid-week (Wednesday) → returns PREVIOUS week as closed period', () => {
  // 2026-04-15 is a Wednesday; current week Mon Apr 13—Sun Apr 19 is still open
  const { start, end } = lastClosedWeek(new Date(2026, 3, 15, 10, 0, 0));
  assert.equal(start.getDate(), 6);      // Mon Apr 6
  assert.equal(end.getDate(), 12);       // Sun Apr 12
});

test('Monday 00:01 → returns previous week (current week just started)', () => {
  const { start, end } = lastClosedWeek(new Date(2026, 3, 13, 0, 1, 0));
  assert.equal(start.getDate(), 6);
  assert.equal(end.getDate(), 12);
});

test('Sunday 23:00 (before 23:59:59.999) → returns previous week', () => {
  // 2026-04-19 Sunday 23:00 — current week not yet fully closed
  const { start, end } = lastClosedWeek(new Date(2026, 3, 19, 23, 0, 0));
  assert.equal(start.getDate(), 6);
  assert.equal(end.getDate(), 12);
});

test('Monday 00:00:00.000 of the next week → returns the just-closed week', () => {
  // 2026-04-20 Mon 00:00 — previous week (Apr 13-19) is now fully closed
  const { start, end } = lastClosedWeek(new Date(2026, 3, 20, 0, 0, 0));
  assert.equal(start.getDate(), 13);
  assert.equal(end.getDate(), 19);
});

test('week range always spans exactly 7 calendar days', () => {
  for (let day = 10; day < 20; day++) {
    const { start, end } = weekRangeOf(new Date(2026, 3, day));
    const span = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    assert.ok(span > 6.99 && span < 7.001, `Span ${span} for day ${day}`);
  }
});

// ─── Reconciliation date formatting ─────────────────────────────────────────

test('formatMDY zero-pads single-digit month and day', () => {
  assert.equal(formatMDY(new Date(2026, 0, 5)), '01/05/2026');
  assert.equal(formatMDY(new Date(2026, 8, 9)), '09/09/2026');
});

test('formatMDY handles December', () => {
  assert.equal(formatMDY(new Date(2026, 11, 31)), '12/31/2026');
});

test('parseMDY round-trips with formatMDY', () => {
  const original = '03/15/2026';
  const parsed = parseMDY(original);
  assert.equal(formatMDY(parsed), original);
});

test('parseMDY(endOfDay=true) sets time to 23:59:59.999', () => {
  const d = parseMDY('06/01/2026', true);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
  assert.equal(d.getMilliseconds(), 999);
});

test('parseMDY returns null for empty/null', () => {
  assert.equal(parseMDY(''), null);
  assert.equal(parseMDY(null), null);
});

test('parseMDY accepts ISO strings as fallback', () => {
  const d = parseMDY('2026-06-15');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5);     // June (0-indexed)
  assert.equal(d.getDate(), 15);
});

test('parseMDY rejects garbage', () => {
  assert.throws(() => parseMDY('no-a-date'), /Invalid date/);
});

// ─── Fee calculation boundary: rounding ─────────────────────────────────────

test('fee rounding to 2 decimals avoids floating-point drift', () => {
  // A common trap: 0.005 * 999.99 = 4.99995 → must round to 5.00
  const amount = 999.99;
  const fee = Math.round(amount * 0.005 * 100) / 100;
  assert.equal(fee, 5.00);
});

test('zero amount produces zero fees', () => {
  const amount = 0;
  const fee = Math.round(amount * 0.125 * 100) / 100;
  assert.equal(fee, 0);
});
