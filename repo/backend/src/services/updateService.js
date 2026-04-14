'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// AdmZip lazy-loaded: only needed when importing update packages
let _AdmZip = null;
function getAdmZip() { return _AdmZip || (_AdmZip = require('adm-zip')); }
const { getDb } = require('../db/pool');
const config = require('../config');
const snapshotSvc = require('./snapshotService');
const rollbackSvc = require('./rollbackService');

if (!fs.existsSync(config.updateDir)) fs.mkdirSync(config.updateDir, { recursive: true });

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function latestInstalled() {
  const { rows } = await getDb().query(
    `SELECT version FROM app_versions WHERE status='installed'
     ORDER BY installed_at DESC LIMIT 1`);
  return rows[0] ? rows[0].version : null;
}

async function importPackage({ filename, buffer, userId }) {
  const checksum = sha256(buffer);
  let zip;
  try { zip = new (getAdmZip())(buffer); }
  catch { const e = new Error('Invalid zip'); e.status = 400; throw e; }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) { const e = new Error('manifest.json missing'); e.status = 400; throw e; }
  let manifest;
  try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); }
  catch { const e = new Error('manifest.json invalid'); e.status = 400; throw e; }
  if (!manifest.version) { const e = new Error('manifest.version required'); e.status = 400; throw e; }

  const installed = await latestInstalled();
  if (manifest.requiresMinVersion && installed &&
      cmpVersions(installed, manifest.requiresMinVersion) < 0) {
    const e = new Error(`Installed ${installed} < requiresMinVersion ${manifest.requiresMinVersion}`);
    e.status = 409; throw e;
  }
  if (installed && cmpVersions(manifest.version, installed) <= 0) {
    const e = new Error(`Package ${manifest.version} not newer than installed ${installed}`);
    e.status = 409; throw e;
  }

  const entries = zip.getEntries();
  const up = new Map(), down = new Map();
  for (const e of entries) {
    const m1 = /^migrations\/up\/(.+)\.sql$/.exec(e.entryName);
    const m2 = /^migrations\/down\/(.+)\.sql$/.exec(e.entryName);
    if (m1) up.set(m1[1],   e.getData().toString('utf8'));
    if (m2) down.set(m2[1], e.getData().toString('utf8'));
  }
  for (const name of up.keys()) {
    if (!down.has(name)) { const e = new Error(`Missing down migration for "${name}"`); e.status = 400; throw e; }
  }

  const destDir = path.join(config.updateDir, manifest.version);
  if (fs.existsSync(destDir)) { const e = new Error(`Version ${manifest.version} already imported`); e.status = 409; throw e; }
  fs.mkdirSync(destDir, { recursive: true });
  const pkgPath = path.join(destDir, filename || 'package.zip');
  fs.writeFileSync(pkgPath, buffer);
  zip.extractAllTo(destDir, true);

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO app_versions (version, manifest, package_path, checksum, imported_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, version, status, imported_at`,
      [manifest.version, manifest, pkgPath, checksum, userId]);
    const version = rows[0];
    for (const [name, upSql] of up.entries()) {
      const downSql = down.get(name);
      const migChecksum = crypto
        .createHash('sha256')
        .update(`${name}\n${upSql}\n${downSql}`)
        .digest('hex');
      await client.query(
        `INSERT INTO schema_migrations (version_id, name, up_sql, down_sql, checksum)
         VALUES ($1,$2,$3,$4,$5)`,
        [version.id, name, upSql, downSql, migChecksum]);
    }
    await client.query('COMMIT');
    return { ...version, migrations: [...up.keys()] };
  } catch (err) {
    await client.query('ROLLBACK');
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    throw err;
  } finally { client.release(); }
}

async function applyVersion(versionId, userId = null) {
  const db = getDb();
  const vres = await db.query(`SELECT id, version, status FROM app_versions WHERE id=$1`, [versionId]);
  if (!vres.rows.length) { const e = new Error('Version not found'); e.status = 404; throw e; }
  const v = vres.rows[0];
  if (v.status !== 'imported') {
    const e = new Error(`Version is ${v.status}; only 'imported' can be applied`); e.status = 409; throw e;
  }

  // 1. Pre-update snapshot. This MUST succeed before migrations run — without
  //    it there is no safe way to roll back.
  const preVersionRow = await db.query(
    `SELECT version FROM app_versions WHERE status='installed'
     ORDER BY installed_at DESC LIMIT 1`);
  const preVersion = preVersionRow.rows[0] ? preVersionRow.rows[0].version : null;

  const snap = await snapshotSvc.createSnapshot({
    versionId,
    preVersion,
    userId,
    metadata: { reason: 'pre_apply', targetVersion: v.version }
  });

  const migs = await db.query(
    `SELECT id, name, up_sql FROM schema_migrations
     WHERE version_id=$1 AND applied_at IS NULL
     ORDER BY id ASC`, [versionId]);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const m of migs.rows) {
      await client.query(m.up_sql);
      await client.query(
        `UPDATE schema_migrations SET applied_at=NOW(), rolled_back_at=NULL WHERE id=$1`, [m.id]);
    }
    await client.query(
      `UPDATE app_versions
         SET status='installed', installed_at=NOW(), applied_at=NOW()
       WHERE id=$1`, [versionId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    await getDb().query(`UPDATE app_versions SET status='failed' WHERE id=$1`, [versionId]);
    throw err;
  } finally { client.release(); }

  return {
    versionId,
    version: v.version,
    applied: migs.rows.length,
    snapshotId: snap.id,
    snapshotChecksum: snap.checksum,
    schemaHash: snap.schema_hash
  };
}

// Delegates to rollbackService — which enforces the full safety contract
// (snapshot presence + checksum + schema compatibility + atomic down-migration + data restore).
async function rollbackVersion(versionId, userId = null) {
  return rollbackSvc.rollback(versionId, userId);
}

async function listVersions() {
  const { rows } = await getDb().query(
    `SELECT v.id, v.version, v.status, v.checksum, v.imported_at, v.installed_at, v.rolled_back_at,
            (SELECT COUNT(*)::int FROM schema_migrations m WHERE m.version_id=v.id) AS migrations
     FROM app_versions v ORDER BY v.imported_at DESC`);
  return rows;
}

async function currentVersion() {
  const { rows } = await getDb().query(
    `SELECT version, installed_at FROM app_versions WHERE status='installed'
     ORDER BY installed_at DESC LIMIT 1`);
  return rows[0] || null;
}

module.exports = { importPackage, applyVersion, rollbackVersion, listVersions, currentVersion };
