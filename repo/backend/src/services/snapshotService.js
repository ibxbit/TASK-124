'use strict';

// Pre-update database snapshots. Dumps every user-table's rows as NDJSON,
// records a schema-hash for drift detection, and can restore transactionally.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db/pool');
const config = require('../config');

const SNAPSHOT_DIR = path.join(config.dataRoot, 'snapshots');

// Tables that carry version history itself — must never be wiped during a restore.
const VERSIONING_TABLES = new Set([
  'app_versions', 'schema_migrations', 'app_snapshots',
  'applied_migrations', 'audit_log', 'users'
]);

function ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function listUserTables(executor) {
  const { rows } = await executor.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`);
  return rows.map(r => r.table_name);
}

async function schemaHash(executor) {
  const { rows } = await executor.query(
    `SELECT table_name, column_name, data_type, ordinal_position
     FROM information_schema.columns
     WHERE table_schema='public'
     ORDER BY table_name, ordinal_position`);
  const text = rows.map(r => `${r.table_name}:${r.column_name}:${r.data_type}`).join(',');
  return sha256(Buffer.from(text));
}

async function resyncSequences(client) {
  const { rows } = await client.query(`
    SELECT pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) AS seq,
           c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_default LIKE 'nextval%'
  `);
  for (const r of rows) {
    if (!r.seq) continue;
    await client.query(
      `SELECT setval($1::regclass,
                     COALESCE((SELECT MAX("${r.column_name}") FROM "${r.table_name}"), 1),
                     (SELECT MAX("${r.column_name}") IS NOT NULL FROM "${r.table_name}"))`,
      [r.seq]);
  }
}

async function createSnapshot(opts = {}) {
  const { versionId = null, preVersion = null, userId = null, metadata = {} } = opts;
  ensureDir();
  const db = getDb();

  const tables = await listUserTables(db);
  const sHash  = await schemaHash(db);

  const filename = `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ndjson`;
  const filePath = path.join(SNAPSHOT_DIR, filename);
  const stream   = fs.createWriteStream(filePath, { encoding: 'utf8' });

  const header = { __meta: { createdAt: new Date().toISOString(),
                              tables, schemaHash: sHash, preVersion } };
  stream.write(JSON.stringify(header) + '\n');

  for (const table of tables) {
    const res = await db.query(`SELECT row_to_json(t) AS r FROM "${table}" t`);
    for (const { r } of res.rows) {
      stream.write(JSON.stringify({ __table: table, row: r }) + '\n');
    }
  }

  await new Promise((resolve, reject) => {
    stream.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const buffer = fs.readFileSync(filePath);
  const checksum = sha256(buffer);

  const { rows } = await db.query(
    `INSERT INTO app_snapshots
       (version_id, pre_version, file_path, size_bytes, checksum, schema_hash, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, version_id, pre_version, file_path, size_bytes, checksum, schema_hash, created_at`,
    [versionId, preVersion, filePath, buffer.length, checksum, sHash, metadata, userId]);
  return rows[0];
}

// Validates snapshot file presence + checksum integrity.
async function validateSnapshotFile(snap) {
  if (!fs.existsSync(snap.file_path)) {
    return { ok: false, reason: 'snapshot_file_missing' };
  }
  const buffer = fs.readFileSync(snap.file_path);
  if (sha256(buffer) !== snap.checksum) {
    return { ok: false, reason: 'snapshot_checksum_mismatch' };
  }
  return { ok: true, buffer };
}

// Restores a snapshot transactionally inside the supplied client.
// Caller is expected to have already verified schema compatibility.
async function restoreWithinTransaction(client, snap) {
  const file = await validateSnapshotFile(snap);
  if (!file.ok) { const e = new Error(file.reason); e.status = 410; throw e; }

  const lines = file.buffer.toString('utf8').split('\n').filter(Boolean);
  if (!lines.length) throw new Error('Snapshot file empty');

  const meta = JSON.parse(lines[0]).__meta;

  // Disable FK checks while we re-insert in arbitrary order
  await client.query(`SET CONSTRAINTS ALL DEFERRED`);
  await client.query(`SET session_replication_role='replica'`);

  // Truncate user tables (preserve version-history tables and audit log)
  for (const t of meta.tables) {
    if (VERSIONING_TABLES.has(t)) continue;
    await client.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }

  // Re-insert each row using its original column set.
  for (let i = 1; i < lines.length; i++) {
    const { __table, row } = JSON.parse(lines[i]);
    if (!__table || VERSIONING_TABLES.has(__table)) continue;
    const cols = Object.keys(row);
    if (!cols.length) continue;
    const vals = cols.map(c => row[c]);
    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',');
    const colList = cols.map(c => `"${c}"`).join(',');
    await client.query(
      `INSERT INTO "${__table}" (${colList}) VALUES (${placeholders})`, vals);
  }

  await resyncSequences(client);
  await client.query(`SET session_replication_role='origin'`);

  return { tables: meta.tables.filter(t => !VERSIONING_TABLES.has(t)).length };
}

async function listSnapshots() {
  const { rows } = await getDb().query(
    `SELECT id, version_id, pre_version, file_path, size_bytes,
            checksum, schema_hash, created_at
     FROM app_snapshots ORDER BY created_at DESC LIMIT 100`);
  return rows;
}

async function getSnapshotForVersion(versionId) {
  const { rows } = await getDb().query(
    `SELECT * FROM app_snapshots WHERE version_id=$1
     ORDER BY created_at DESC LIMIT 1`, [versionId]);
  return rows[0] || null;
}

module.exports = {
  createSnapshot,
  listSnapshots,
  getSnapshotForVersion,
  validateSnapshotFile,
  restoreWithinTransaction,
  schemaHash,
  listUserTables,
  VERSIONING_TABLES
};
