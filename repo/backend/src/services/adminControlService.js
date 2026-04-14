'use strict';

const { getDb } = require('../db/pool');
const { reloadDictionary } = require('./sensitiveWordFilter');

async function addBlacklist(kind, value, adminUserId) {
  if (!['word', 'user'].includes(kind)) {
    const e = new Error('kind must be word or user'); e.status = 400; throw e;
  }
  const { rows } = await getDb().query(
    `INSERT INTO blacklists (kind, value, added_by) VALUES ($1,$2,$3)
     ON CONFLICT (kind, value) DO UPDATE SET added_by = EXCLUDED.added_by
     RETURNING id, kind, value, created_at`,
    [kind, value, adminUserId]);
  if (kind === 'word') reloadDictionary();
  return rows[0];
}

async function removeBlacklist(id) {
  await getDb().query(`DELETE FROM blacklists WHERE id=$1`, [id]);
  reloadDictionary();
  return { id };
}

async function listBlacklist(kind) {
  const params = [];
  let where = '';
  if (kind) { params.push(kind); where = `WHERE kind = $1`; }
  const { rows } = await getDb().query(
    `SELECT id, kind, value, created_at FROM blacklists ${where} ORDER BY created_at DESC`, params);
  return rows;
}

async function isUserBlacklisted(userId) {
  const { rows } = await getDb().query(
    `SELECT 1 FROM blacklists WHERE kind='user' AND value=$1 LIMIT 1`, [userId]);
  return rows.length > 0;
}

async function getThrottlePolicy(key) {
  const { rows } = await getDb().query(
    `SELECT key, max_count, window_seconds FROM throttle_policies WHERE key=$1`, [key]);
  return rows[0] || null;
}

async function setThrottlePolicy(key, maxCount, windowSeconds, adminUserId) {
  if (maxCount <= 0 || windowSeconds <= 0) {
    const e = new Error('maxCount and windowSeconds must be > 0'); e.status = 400; throw e;
  }
  const { rows } = await getDb().query(
    `INSERT INTO throttle_policies (key, max_count, window_seconds, updated_by, updated_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (key) DO UPDATE
       SET max_count=EXCLUDED.max_count,
           window_seconds=EXCLUDED.window_seconds,
           updated_by=EXCLUDED.updated_by,
           updated_at=NOW()
     RETURNING key, max_count, window_seconds, updated_at`,
    [key, maxCount, windowSeconds, adminUserId]);
  return rows[0];
}

async function listThrottlePolicies() {
  const { rows } = await getDb().query(
    `SELECT key, max_count, window_seconds, updated_at FROM throttle_policies ORDER BY key`);
  return rows;
}

module.exports = {
  addBlacklist, removeBlacklist, listBlacklist, isUserBlacklisted,
  getThrottlePolicy, setThrottlePolicy, listThrottlePolicies
};
