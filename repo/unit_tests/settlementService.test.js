'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { weekRangeOf, lastClosedWeek, weekRangeForCutoff } = require('../backend/src/services/settlementService');

// ─── weekRangeOf ────────────────────────────────────────────────────────────

test('weekRangeOf: Wednesday → Monday-to-Sunday', () => {
  const { start, end } = weekRangeOf(new Date('2026-04-15T12:00:00'));
  assert.equal(start.getDay(), 1); // Monday
  assert.equal(end.getDay(), 0);   // Sunday
  assert.ok(end > start);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('weekRangeOf: Monday gives same-day as start', () => {
  const { start } = weekRangeOf(new Date('2026-04-13T10:00:00'));
  assert.equal(start.getDay(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});

test('weekRangeOf: Sunday → end is same Sunday', () => {
  const { end } = weekRangeOf(new Date('2026-04-19T23:00:00'));
  assert.equal(end.getDay(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('weekRangeOf: range is ~7 days', () => {
  const { start, end } = weekRangeOf(new Date('2026-01-01'));
  const diffMs = end - start;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  assert.ok(diffDays >= 6.99 && diffDays <= 7.01);
});

// ─── lastClosedWeek ─────────────────────────────────────────────────────────

test('lastClosedWeek: mid-week returns previous week', () => {
  const { start, end } = lastClosedWeek(new Date('2026-04-15T12:00:00'));
  const thisMonday = weekRangeOf(new Date('2026-04-15')).start;
  assert.ok(end < thisMonday, 'closed week end should be before current Monday');
});

test('lastClosedWeek: after Sunday cutoff returns that same week', () => {
  const { end: sundayEnd } = weekRangeOf(new Date('2026-04-15'));
  const afterCutoff = new Date(sundayEnd.getTime() + 1);
  const { end } = lastClosedWeek(afterCutoff);
  assert.equal(end.getTime(), sundayEnd.getTime());
});

test('lastClosedWeek: Monday 00:00 → previous week is closed', () => {
  const result = lastClosedWeek(new Date('2026-04-13T00:00:00'));
  const thisMonday = weekRangeOf(new Date('2026-04-13')).start;
  assert.ok(result.end < thisMonday);
});

test('weekRangeForCutoff: alias for lastClosedWeek', () => {
  const now = new Date('2026-04-15T12:00:00');
  const a = lastClosedWeek(now);
  const b = weekRangeForCutoff(now);
  assert.equal(a.start.getTime(), b.start.getTime());
  assert.equal(a.end.getTime(), b.end.getTime());
});
