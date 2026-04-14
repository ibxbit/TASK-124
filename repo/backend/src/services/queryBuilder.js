'use strict';

// Parameterized SQL builder for analytics filters. Whitelists inputs.

const ALLOWED_SORT_COLUMNS = new Set([
  'occurred_at', 'provider', 'sku', 'experiment_bucket',
  'amount', 'refund_reason', 'order_id', 'id'
]);

const MAX_LIMIT = 200_000;
const DEFAULT_LIMIT = 100;

function buildWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const push = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.dateFrom) push('occurred_at >= ?', filters.dateFrom);
  if (filters.dateTo)   push('occurred_at <= ?', filters.dateTo);

  if (Array.isArray(filters.providers) && filters.providers.length)
    push('provider = ANY(?)', filters.providers);
  if (Array.isArray(filters.skus) && filters.skus.length)
    push('sku = ANY(?)', filters.skus);
  if (Array.isArray(filters.experimentBuckets) && filters.experimentBuckets.length)
    push('experiment_bucket = ANY(?)', filters.experimentBuckets);
  if (Array.isArray(filters.refundReasons) && filters.refundReasons.length)
    push('refund_reason = ANY(?)', filters.refundReasons);

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return { where, params };
}

function buildOrder(sort) {
  if (!sort || !sort.column) return 'ORDER BY occurred_at DESC';
  if (!ALLOWED_SORT_COLUMNS.has(sort.column)) {
    throw new Error(`Invalid sort column: ${sort.column}`);
  }
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${sort.column} ${dir}`;
}

function buildPagination({ page = 1, pageSize = DEFAULT_LIMIT } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const pg   = Math.max(Number(page) || 1, 1);
  return { limit: size, offset: (pg - 1) * size };
}

function buildSelectQuery(def) {
  const { where, params } = buildWhere(def.filters);
  const order = buildOrder(def.sort);
  const { limit, offset } = buildPagination(def.pagination);

  const dataSql = `
    SELECT id, occurred_at, provider, sku, experiment_bucket,
           amount, currency, refund_reason, order_id
    FROM transactions
    ${where}
    ${order}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const countSql = `SELECT COUNT(*)::bigint AS total FROM transactions ${where}`;
  return {
    dataSql, dataParams: [...params, limit, offset],
    countSql, countParams: params,
    limit, offset
  };
}

function buildStreamQuery(def, cap = MAX_LIMIT) {
  const { where, params } = buildWhere(def.filters);
  const order = buildOrder(def.sort);
  const sql = `
    SELECT id, occurred_at, provider, sku, experiment_bucket,
           amount, currency, refund_reason, order_id
    FROM transactions
    ${where}
    ${order}
    LIMIT $${params.length + 1}
  `;
  return { sql, params: [...params, cap] };
}

module.exports = { buildSelectQuery, buildStreamQuery, MAX_LIMIT };
