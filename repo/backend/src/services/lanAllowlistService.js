'use strict';

// Approved-machine allowlist for LAN mode.
// When LAN_ONLY=true, every inbound request's IP must match an active row
// (or be loopback). The allowlist is cached in-process and refreshed every 60s.

const { getDb } = require('../db/pool');

let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function refresh() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  try {
    const { rows } = await getDb().query(
      `SELECT ip_address FROM lan_allowlist WHERE active=true`);
    cache = new Set(rows.map(r => r.ip_address));
  } catch {
    if (!cache) cache = new Set();
  }
  cacheAt = Date.now();
  return cache;
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

async function isAllowed(ip) {
  if (isLoopback(ip)) return true;
  const allowed = await refresh();
  return allowed.has(ip);
}

async function add(ip, label, userId) {
  if (!ip) { const e = new Error('ip_address required'); e.status = 400; throw e; }
  const { rows } = await getDb().query(
    `INSERT INTO lan_allowlist (ip_address, label, added_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (ip_address) DO UPDATE SET active=true, label=EXCLUDED.label, added_by=EXCLUDED.added_by
     RETURNING id, ip_address, label, active, created_at`,
    [ip, label || null, userId]);
  cache = null;
  return rows[0];
}

async function remove(id) {
  await getDb().query(`UPDATE lan_allowlist SET active=false WHERE id=$1`, [id]);
  cache = null;
  return { id };
}

async function list() {
  const { rows } = await getDb().query(
    `SELECT id, ip_address, label, active, created_at
     FROM lan_allowlist ORDER BY created_at DESC`);
  return rows;
}

module.exports = { isAllowed, add, remove, list, isLoopback, refresh };
