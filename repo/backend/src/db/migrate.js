'use strict';

// Applies every .sql file in the /database folder in sorted order,
// tracking which migrations have run via a `applied_migrations` table.
const fs = require('fs');
const path = require('path');
const { getDb } = require('./pool');
const config = require('../config');

async function ensureTable(db) {
  // Pool connections that sat idle through hundreds of upstream queries can
  // be reset by the DB side. Retry once on transient connection errors — the
  // pool hands us a fresh connection on the second attempt.
  const sql = `
    CREATE TABLE IF NOT EXISTS applied_migrations (
      name       VARCHAR(256) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `;
  try {
    await db.query(sql);
  } catch (err) {
    if (err.code === 'ECONNRESET' || /ECONNRESET|terminating connection|connection terminated/.test(err.message || '')) {
      await new Promise(r => setTimeout(r, 250));
      await db.query(sql);
    } else {
      throw err;
    }
  }
}

async function appliedNames(db) {
  const { rows } = await db.query(`SELECT name FROM applied_migrations`);
  return new Set(rows.map(r => r.name));
}

// Extract -- DOWN ... blocks from SQL
function parseDownSql(sql) {
  const marker = '-- DOWN';
  const idx = sql.lastIndexOf(marker);
  if (idx === -1) return '';
  return sql.slice(idx + marker.length).split('\n')
    .map(line => line.replace(/^--\s?/, '').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

async function ensureBaselineVersion(db) {
  // Ensure the baseline version exists so we can link migrations to it.
  const version = '1.0.0';
  const { rows } = await db.query(
    'SELECT id FROM app_versions WHERE version = $1', [version]);
  if (rows.length) return rows[0].id;

  const { rows: inserted } = await db.query(
    `INSERT INTO app_versions (version, manifest, package_path, checksum, status, installed_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
    [version, {}, 'baseline', 'none', 'installed']
  );
  return inserted[0].id;
}

async function syncToSchemaMigrations(db, file, upSql, downSql) {
  // If the versioning system exists, register this migration there too.
  // Check whether the table exists first to avoid a query error that would
  // abort the surrounding transaction in PostgreSQL.
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_versions'
  `);
  if (!rows.length) return; // versioning tables not yet created (009 hasn't run)

  const versionId = await ensureBaselineVersion(db);
  await db.query(`
    INSERT INTO schema_migrations (version_id, name, up_sql, down_sql, applied_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (version_id, name) DO NOTHING
  `, [versionId, file, upSql, downSql || '-- no down sql provided']);
}

async function runAll() {
  const db = getDb();
  await ensureTable(db);
  const done = await appliedNames(db);

  const files = fs.readdirSync(config.migrationsDir)
    .filter(n => n.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    const downSql = parseDownSql(sql);

    if (done.has(file)) {
      // Even if already applied via applied_migrations, 
      // sync to schema_migrations for rollback support if missing.
      await syncToSchemaMigrations(db, file, sql, downSql);
      continue;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO applied_migrations (name) VALUES ($1)`, [file]);
      await syncToSchemaMigrations(client, file, sql, downSql);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] failed on ${file}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runAll().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runAll };
