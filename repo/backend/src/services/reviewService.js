'use strict';

const { getDb } = require('../db/pool');
const { validate } = require('./reviewValidation');
const anomaly = require('./anomalyDetector');

function publicView(r) {
  return {
    id: r.id,
    orderId: r.order_id,
    orderLineItemId: r.order_line_item_id,
    rating: r.rating,
    tags: r.tags,
    body: r.body,
    anonymous: r.anonymous,
    reviewer: r.anonymous ? null : r.reviewer_id,
    status: r.status,
    createdAt: r.created_at
  };
}

async function createReview(input) {
  const errors = validate(input);
  if (errors.length) { const e = new Error(errors.join('; ')); e.status = 400; throw e; }

  const { orderLineItemId, orderId, reviewerId, deviceId,
          rating, tags = [], body = null, anonymous = false } = input;

  // Verify the order line item exists in the authoritative table
  const { rows: oli } = await getDb().query(
    `SELECT id FROM order_line_items WHERE id=$1`, [orderLineItemId]);
  if (!oli.length) {
    const e = new Error(`Order line item "${orderLineItemId}" not found`);
    e.status = 404; throw e;
  }

  let row;
  try {
    const res = await getDb().query(
      `INSERT INTO reviews
         (order_line_item_id, order_id, reviewer_id, device_id,
          rating, tags, body, anonymous)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, order_line_item_id, order_id, reviewer_id, device_id,
                 rating, tags, body, anonymous, status, created_at`,
      [orderLineItemId, orderId, reviewerId, deviceId, rating, tags, body, anonymous]
    );
    row = res.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Review already exists for this order line item');
      e.status = 409; throw e;
    }
    throw err;
  }

  const anomalies = await anomaly.runChecks(row);
  return { review: publicView(row), anomalies };
}

async function listReviews(opts = {}) {
  const { status, limit = 100, offset = 0 } = opts;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE status = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await getDb().query(
    `SELECT * FROM reviews ${where} ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(publicView);
}

async function getReview(id) {
  const { rows } = await getDb().query(`SELECT * FROM reviews WHERE id=$1`, [id]);
  return rows[0] ? publicView(rows[0]) : null;
}

module.exports = { createReview, listReviews, getReview };
