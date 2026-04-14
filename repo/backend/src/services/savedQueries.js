'use strict';

const { getDb } = require('../db/pool');

async function list(userId) {
  const { rows } = await getDb().query(
    `SELECT id, name, definition, created_at, updated_at
     FROM saved_queries WHERE user_id=$1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows;
}

async function create(userId, name, definition) {
  const { rows } = await getDb().query(
    `INSERT INTO saved_queries (user_id, name, definition)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id, name)
     DO UPDATE SET definition = EXCLUDED.definition, updated_at = NOW()
     RETURNING id, name, definition, created_at, updated_at`,
    [userId, name, definition]
  );
  return rows[0];
}

async function get(userId, id) {
  const { rows } = await getDb().query(
    `SELECT id, name, definition FROM saved_queries WHERE user_id=$1 AND id=$2`,
    [userId, id]
  );
  return rows[0] || null;
}

async function remove(userId, id) {
  await getDb().query(
    `DELETE FROM saved_queries WHERE user_id=$1 AND id=$2`,
    [userId, id]
  );
}

module.exports = { list, create, get, remove };
