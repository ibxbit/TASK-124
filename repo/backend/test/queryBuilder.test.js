'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSelectQuery, buildStreamQuery, MAX_LIMIT } =
  require('../src/services/queryBuilder');

// ─── Filter assembly ────────────────────────────────────────────────────────

test('empty filters produce no WHERE clause', () => {
  const { dataSql, dataParams, countSql, countParams } =
    buildSelectQuery({ filters: {} });
  assert.ok(!dataSql.includes('WHERE'));
  assert.ok(!countSql.includes('WHERE'));
  // Only limit+offset params
  assert.equal(dataParams.length, 2);
  assert.equal(countParams.length, 0);
});

test('dateFrom + dateTo produce two range clauses with $1 and $2', () => {
  const q = buildSelectQuery({
    filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31' }
  });
  assert.ok(q.dataSql.includes('occurred_at >= $1'));
  assert.ok(q.dataSql.includes('occurred_at <= $2'));
  assert.equal(q.countParams[0], '2026-01-01');
  assert.equal(q.countParams[1], '2026-01-31');
});

test('provider filter becomes ANY($N)', () => {
  const q = buildSelectQuery({
    filters: { providers: ['stripe', 'adyen'] }
  });
  assert.ok(q.dataSql.includes('provider = ANY($1)'));
  assert.deepEqual(q.countParams[0], ['stripe', 'adyen']);
});

test('all five filter types combine with AND', () => {
  const q = buildSelectQuery({
    filters: {
      dateFrom: '2026-01-01', dateTo: '2026-12-31',
      providers: ['x'], skus: ['y'],
      experimentBuckets: ['A'], refundReasons: ['late']
    }
  });
  const ands = q.dataSql.match(/AND/g) || [];
  assert.equal(ands.length, 5);     // 6 clauses → 5 ANDs
  assert.equal(q.countParams.length, 6);
});

test('empty arrays are ignored (no clause emitted)', () => {
  const q = buildSelectQuery({
    filters: { providers: [], skus: [] }
  });
  assert.ok(!q.dataSql.includes('ANY'));
});

test('non-array providers are ignored', () => {
  const q = buildSelectQuery({
    filters: { providers: 'single-string' }  // not array
  });
  assert.ok(!q.dataSql.includes('provider = ANY'), 'non-array string should not emit ANY clause');
});

// ─── Sort safety ────────────────────────────────────────────────────────────

test('default sort is occurred_at DESC', () => {
  const q = buildSelectQuery({ filters: {} });
  assert.ok(q.dataSql.includes('ORDER BY occurred_at DESC'));
});

test('whitelisted column in asc direction', () => {
  const q = buildSelectQuery({ filters: {}, sort: { column: 'amount', direction: 'asc' } });
  assert.ok(q.dataSql.includes('ORDER BY amount ASC'));
});

test('non-whitelisted sort column throws', () => {
  assert.throws(
    () => buildSelectQuery({ filters: {}, sort: { column: 'DROP TABLE' } }),
    /Invalid sort column/);
});

test('SQL injection via sort column is impossible', () => {
  assert.throws(
    () => buildSelectQuery({ filters: {}, sort: { column: 'id; DROP' } }),
    /Invalid sort column/);
});

// ─── Pagination ─────────────────────────────────────────────────────────────

test('defaults to page 1, limit 100', () => {
  const q = buildSelectQuery({ filters: {} });
  assert.equal(q.limit, 100);
  assert.equal(q.offset, 0);
});

test('page 3, pageSize 50 → offset 100', () => {
  const q = buildSelectQuery({ filters: {}, pagination: { page: 3, pageSize: 50 } });
  assert.equal(q.limit, 50);
  assert.equal(q.offset, 100);
});

test('pageSize is capped at MAX_LIMIT', () => {
  const q = buildSelectQuery({ filters: {}, pagination: { pageSize: 999_999 } });
  assert.equal(q.limit, MAX_LIMIT);
});

test('pageSize zero falls back to default', () => {
  const q = buildSelectQuery({ filters: {}, pagination: { pageSize: 0 } });
  assert.equal(q.limit, 100);
});

test('negative page falls back to 1', () => {
  const q = buildSelectQuery({ filters: {}, pagination: { page: -5 } });
  assert.equal(q.offset, 0);
});

// ─── Stream query ───────────────────────────────────────────────────────────

test('buildStreamQuery applies custom cap instead of offset', () => {
  const q = buildStreamQuery({ filters: {} }, 50_000);
  assert.ok(q.sql.includes('LIMIT'));
  assert.equal(q.params[q.params.length - 1], 50_000);
});

test('buildStreamQuery defaults cap to MAX_LIMIT', () => {
  const q = buildStreamQuery({ filters: {} });
  assert.equal(q.params[q.params.length - 1], MAX_LIMIT);
});
