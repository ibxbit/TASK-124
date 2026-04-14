'use strict';

const { getDb } = require('../db/pool');
const { assignBucket } = require('./bucketing');

async function listExperiments() {
  const { rows } = await getDb().query(
    `SELECT e.id, e.name, e.description,
            (SELECT MAX(version) FROM experiment_versions WHERE experiment_id=e.id) AS latest_version
     FROM experiments e ORDER BY e.id`);
  return rows;
}

async function createExperiment(name, description) {
  const { rows } = await getDb().query(
    `INSERT INTO experiments (name, description) VALUES ($1,$2)
     RETURNING id, name, description`,
    [name, description || null]
  );
  return rows[0];
}

async function createVersion(experimentId, userId, opts) {
  const { startTs, endTs, trafficSplit } = opts;
  const db = getDb();
  const next = await db.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM experiment_versions WHERE experiment_id=$1`,
    [experimentId]);
  const version = next.rows[0].next;
  const { rows } = await db.query(
    `INSERT INTO experiment_versions
       (experiment_id, version, start_ts, end_ts, traffic_split, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, experiment_id, version, start_ts, end_ts, traffic_split`,
    [experimentId, version, startTs, endTs, trafficSplit, userId]
  );
  return rows[0];
}

async function getActiveVersion(experimentId, at) {
  const time = at || new Date();
  const { rows } = await getDb().query(
    `SELECT version, start_ts, end_ts, traffic_split
     FROM experiment_versions
     WHERE experiment_id=$1 AND start_ts <= $2 AND end_ts >= $2
     ORDER BY version DESC LIMIT 1`,
    [experimentId, time]
  );
  return rows[0] || null;
}

async function getAssignment(experimentId, userId, at) {
  const active = await getActiveVersion(experimentId, at);
  if (!active) return null;
  const bucket = assignBucket(userId, experimentId, active.version, active.traffic_split);
  return { experimentId, userId, version: active.version, bucket };
}

module.exports = { listExperiments, createExperiment, createVersion, getActiveVersion, getAssignment };
