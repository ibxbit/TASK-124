'use strict';

// 60-second checkpoints for settlement / moderation / experiments.
// Every row carries a monotonic sequence + sha256 checksum so recovery can
// reject tampered or corrupt snapshots.

const { getDb } = require('../db/pool');
const { checksumOf, verify } = require('./checkpointIntegrity');

const INTERVAL_MS = 60 * 1000;
let timer = null;

async function writeCheckpoint(db, kind, key, payload) {
  const seqRes = await db.query(`SELECT nextval('checkpoint_sequence') AS s`);
  const sequence = Number(seqRes.rows[0].s);
  const checksum = checksumOf(payload);
  await db.query(
    `INSERT INTO checkpoints (kind, key, payload, sequence, checksum)
     VALUES ($1,$2,$3,$4,$5)`,
    [kind, key, payload, sequence, checksum]);
}

async function snapshotSettlement(db) {
  const { rows } = await db.query(
    `SELECT id, period_start, period_end, status,
            total_gross, total_fees, total_net,
            (SELECT COUNT(*)::int FROM settlement_lines WHERE cycle_id=c.id) AS lines
     FROM settlement_cycles c WHERE status='running'`);
  for (const c of rows) {
    await writeCheckpoint(db, 'settlement', String(c.id), c);
  }
}

async function snapshotModerationQueue(db) {
  const [openReports, pendingAppeals, pendingContentAppeals] = await Promise.all([
    db.query(`SELECT id, target_type, target_id, reason, created_at
              FROM content_reports WHERE status='open' ORDER BY id`),
    db.query(`SELECT id, review_id, status, created_at
              FROM review_appeals WHERE status='pending' ORDER BY id`),
    db.query(`SELECT id, report_id, status, created_at
              FROM content_appeals WHERE status='pending' ORDER BY id`)
  ]);
  const payload = {
    openReports:           openReports.rows,
    pendingReviewAppeals:  pendingAppeals.rows,
    pendingContentAppeals: pendingContentAppeals.rows,
    counts: {
      openReports:           openReports.rows.length,
      pendingReviewAppeals:  pendingAppeals.rows.length,
      pendingContentAppeals: pendingContentAppeals.rows.length
    },
    countedAt: new Date().toISOString()
  };
  await writeCheckpoint(db, 'moderation_queue', 'open', payload);
}

async function snapshotExperiments(db) {
  const { rows } = await db.query(
    `SELECT v.experiment_id, v.version, v.start_ts, v.end_ts, v.traffic_split, e.name
     FROM experiment_versions v JOIN experiments e ON e.id = v.experiment_id
     WHERE v.start_ts <= NOW() AND v.end_ts >= NOW()
     ORDER BY v.experiment_id, v.version`);
  await writeCheckpoint(db, 'experiments', 'active_versions',
    { versions: rows, count: rows.length, countedAt: new Date().toISOString() });
}

async function runOnce() {
  const db = getDb();
  try {
    await snapshotSettlement(db);
    await snapshotModerationQueue(db);
    await snapshotExperiments(db);
  } catch (err) {
    console.error('[checkpoint] failed:', err.message);
  }
}

function start() {
  if (timer) return;
  runOnce();
  timer = setInterval(runOnce, INTERVAL_MS);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

async function latest(kind, key) {
  const where = key
    ? `WHERE kind=$1 AND key=$2`
    : `WHERE kind=$1`;
  const params = key ? [kind, key] : [kind];
  const { rows } = await getDb().query(
    `SELECT id, kind, key, payload, sequence, checksum, checkpoint_at
     FROM checkpoints ${where} ORDER BY sequence DESC NULLS LAST, checkpoint_at DESC LIMIT 1`,
    params);
  return rows[0] || null;
}

async function listRecent(limit = 50) {
  const n = Math.min(Number(limit) || 50, 500);
  const { rows } = await getDb().query(
    `SELECT id, kind, key, sequence, checksum, checkpoint_at FROM checkpoints
     ORDER BY sequence DESC NULLS LAST, checkpoint_at DESC LIMIT $1`, [n]);
  return rows;
}

// Verifies a single row's checksum integrity — same function used by recovery.
function verifyRow(row) { return verify(row); }

module.exports = {
  start, stop, runOnce,
  latest, listRecent, verifyRow,
  INTERVAL_MS
};
