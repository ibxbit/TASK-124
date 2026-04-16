'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { precisionRecall, ndcgAtK, diversity } = require('../backend/src/services/offlineMetrics');

// ─── precisionRecall ────────────────────────────────────────────────────────

test('precisionRecall: perfect top-K → precision=1, recall=1', () => {
  const recs = [1,2,3,4,5,6,7,8,9,10];
  const truth = new Set([1,2,3,4,5,6,7,8,9,10]);
  const { precision, recall } = precisionRecall(recs, truth);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test('precisionRecall: no overlap → precision=0, recall=0', () => {
  const { precision, recall } = precisionRecall([11,12,13], new Set([1,2,3]));
  assert.equal(precision, 0);
  assert.equal(recall, 0);
});

test('precisionRecall: half overlap in top-K', () => {
  const { precision, recall } = precisionRecall(
    [1,2,3,4,5,6,7,8,9,10], new Set([1,3,5,7,9]));
  assert.equal(precision, 0.5);
  assert.equal(recall, 1);
});

test('precisionRecall: relevant item past K=10 is not counted', () => {
  const recs = Array.from({length: 20}, (_, i) => i + 1);
  const { precision, recall } = precisionRecall(recs, new Set([15]));
  assert.equal(precision, 0);
  assert.equal(recall, 0);
});

test('precisionRecall: empty recs → 0,0', () => {
  const { precision, recall } = precisionRecall([], new Set([1,2]));
  assert.equal(precision, 0);
  assert.equal(recall, 0);
});

test('precisionRecall: empty truth → 0,0', () => {
  const { precision, recall } = precisionRecall([1,2], new Set());
  assert.equal(precision, 0);
  assert.equal(recall, 0);
});

// ─── ndcgAtK ────────────────────────────────────────────────────────────────

test('ndcgAtK: perfect ranking → 1.0', () => {
  assert.equal(ndcgAtK([1,2,3,4,5], new Set([1,2,3,4,5])), 1);
});

test('ndcgAtK: no relevant items → 0', () => {
  assert.equal(ndcgAtK([11,12,13], new Set([1,2,3])), 0);
});

test('ndcgAtK: relevant item at rank 1 scores higher than at rank 10', () => {
  const truth = new Set([42]);
  const atFirst = ndcgAtK([42, 1, 2, 3], truth);
  const atLast  = ndcgAtK([1, 2, 3, 4, 5, 6, 7, 8, 9, 42], truth);
  assert.ok(atFirst > atLast);
});

test('ndcgAtK: empty recs → 0', () => {
  assert.equal(ndcgAtK([], new Set([1])), 0);
});

test('ndcgAtK: empty truth → 0', () => {
  assert.equal(ndcgAtK([1,2], new Set()), 0);
});

// ─── diversity ──────────────────────────────────────────────────────────────

test('diversity: all same category → 0', () => {
  assert.equal(diversity(Array.from({length: 5}, () => ({ category: 'A' }))), 0);
});

test('diversity: all different categories → 1', () => {
  assert.equal(diversity('ABCDEFGHIJ'.split('').map(c => ({ category: c }))), 1);
});

test('diversity: mixed categories', () => {
  const items = [
    { category: 'A' }, { category: 'A' },
    { category: 'B' }, { category: 'B' },
    { category: 'C' }
  ];
  const d = diversity(items);
  assert.ok(d > 0 && d < 1);
});

test('diversity: fewer than 2 items → 0', () => {
  assert.equal(diversity([{ category: 'A' }]), 0);
  assert.equal(diversity([]), 0);
});

test('diversity: items without category → no same-pairs → 1', () => {
  assert.equal(diversity([{}, {}, {}]), 1);
});

test('diversity: truncated to K=10', () => {
  const items = Array.from({length: 20}, (_, i) => ({ category: i < 10 ? 'A' : 'B' }));
  assert.equal(diversity(items), 0); // top-10 all 'A'
});
