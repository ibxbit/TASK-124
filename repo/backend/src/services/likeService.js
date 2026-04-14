'use strict';

const { getDb } = require('../db/pool');

const TYPES = new Set(['review', 'comment']);
const KINDS = new Set(['like', 'favorite']);

function validate({ targetType, kind }) {
  if (!TYPES.has(targetType)) { const e = new Error('Invalid targetType'); e.status = 400; throw e; }
  if (!KINDS.has(kind))       { const e = new Error('Invalid kind');       e.status = 400; throw e; }
}

async function addLike(userId, opts) {
  const { targetType, targetId, kind = 'like' } = opts;
  validate({ targetType, kind });
  await getDb().query(
    `INSERT INTO likes (user_id, target_type, target_id, kind) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [userId, targetType, targetId, kind]);
  return { userId, targetType, targetId, kind };
}

async function removeLike(userId, opts) {
  const { targetType, targetId, kind = 'like' } = opts;
  validate({ targetType, kind });
  await getDb().query(
    `DELETE FROM likes WHERE user_id=$1 AND target_type=$2 AND target_id=$3 AND kind=$4`,
    [userId, targetType, targetId, kind]);
  return { userId, targetType, targetId, kind };
}

async function count(opts) {
  const { targetType, targetId, kind = 'like' } = opts;
  validate({ targetType, kind });
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM likes
     WHERE target_type=$1 AND target_id=$2 AND kind=$3`,
    [targetType, targetId, kind]);
  return rows[0].c;
}

module.exports = { addLike, removeLike, count };
