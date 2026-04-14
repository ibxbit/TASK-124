'use strict';

// Ingestion service for experiment event logs and offline recommendation eval data.
// Accepts structured JSON arrays and validates schema before inserting.

const { getDb } = require('../db/pool');

const VALID_EVENT_TYPES = new Set(['impression', 'click', 'conversion']);

// ── Event log ingestion ────────────────────────────────────────────────────

function validateEvent(ev, idx) {
  const errors = [];
  if (!ev.experiment_id && ev.experiment_id !== 0) errors.push(`[${idx}] experiment_id required`);
  if (!Number.isInteger(ev.version))               errors.push(`[${idx}] version must be integer`);
  if (!ev.user_id)                                 errors.push(`[${idx}] user_id required`);
  if (!ev.bucket)                                  errors.push(`[${idx}] bucket required`);
  if (!VALID_EVENT_TYPES.has(ev.event_type))       errors.push(`[${idx}] event_type must be one of: ${[...VALID_EVENT_TYPES].join(', ')}`);
  if (!ev.occurred_at)                             errors.push(`[${idx}] occurred_at required`);
  else if (isNaN(new Date(ev.occurred_at)))        errors.push(`[${idx}] occurred_at invalid date`);
  return errors;
}

async function ingestEvents(events) {
  if (!Array.isArray(events) || !events.length) {
    const e = new Error('events must be a non-empty array'); e.status = 400; throw e;
  }

  const allErrors = [];
  for (let i = 0; i < events.length; i++) {
    allErrors.push(...validateEvent(events[i], i));
  }
  if (allErrors.length) {
    const e = new Error(`Validation failed: ${allErrors.slice(0, 10).join('; ')}${allErrors.length > 10 ? ` (and ${allErrors.length - 10} more)` : ''}`);
    e.status = 400;
    e.details = allErrors;
    throw e;
  }

  const db = getDb();
  const client = await db.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const ev of events) {
      await client.query(
        `INSERT INTO experiment_events
           (experiment_id, version, user_id, bucket, event_type, item_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ev.experiment_id, ev.version, ev.user_id, ev.bucket,
         ev.event_type, ev.item_id || null, new Date(ev.occurred_at)]);
      inserted++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }

  return { inserted };
}

// ── Recommendation run ingestion ───────────────────────────────────────────

async function ingestRecommendationRun(data) {
  if (!data || !data.name) {
    const e = new Error('name required'); e.status = 400; throw e;
  }
  const items = data.items;
  const groundTruth = data.ground_truth;
  if (!Array.isArray(items) || !items.length) {
    const e = new Error('items must be a non-empty array'); e.status = 400; throw e;
  }

  const errors = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.user_id)                         errors.push(`items[${i}] user_id required`);
    if (!Number.isInteger(it.rank))          errors.push(`items[${i}] rank must be integer`);
    if (!it.item_id)                         errors.push(`items[${i}] item_id required`);
  }
  if (Array.isArray(groundTruth)) {
    for (let i = 0; i < groundTruth.length; i++) {
      const g = groundTruth[i];
      if (!g.user_id) errors.push(`ground_truth[${i}] user_id required`);
      if (!g.item_id) errors.push(`ground_truth[${i}] item_id required`);
    }
  }
  if (errors.length) {
    const e = new Error(`Validation failed: ${errors.slice(0, 10).join('; ')}`);
    e.status = 400; e.details = errors; throw e;
  }

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query(
      `INSERT INTO recommendation_runs (name) VALUES ($1) RETURNING id, name, created_at`,
      [data.name]);
    const runId = run.rows[0].id;

    for (const it of items) {
      await client.query(
        `INSERT INTO recommendation_items (run_id, user_id, rank, item_id, category)
         VALUES ($1,$2,$3,$4,$5)`,
        [runId, it.user_id, it.rank, it.item_id, it.category || null]);
    }

    if (Array.isArray(groundTruth)) {
      for (const g of groundTruth) {
        await client.query(
          `INSERT INTO recommendation_ground_truth (run_id, user_id, item_id)
           VALUES ($1,$2,$3)`,
          [runId, g.user_id, g.item_id]);
      }
    }

    await client.query('COMMIT');
    return {
      runId,
      name: data.name,
      itemsInserted: items.length,
      groundTruthInserted: Array.isArray(groundTruth) ? groundTruth.length : 0
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

module.exports = { ingestEvents, ingestRecommendationRun };
