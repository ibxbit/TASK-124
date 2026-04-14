'use strict';

// Safe rollback orchestrator.
//
// Process per rollback:
//   1. Safety checks (pre-transaction, hard-failing):
//        - version is currently installed
//        - snapshot exists for that version
//        - snapshot file present + checksum valid
//   2. BEGIN transaction:
//        - Run every still-applied down-migration in reverse order
//        - Recompute schema hash; it MUST match the snapshot's schema_hash.
//          If not → abort (schema drift detected).
//        - Restore data from snapshot (caller-supplied helper)
//        - Mark version rolled_back + migrations rolled_back_at
//      COMMIT — atomic success/failure.
//
// Exposed:
//   validate(versionId)              dry-run: reports reason if rollback blocked
//   rollback(versionId, userId)      performs the full rollback
//
const fs = require('fs');
const { getDb } = require('../db/pool');
const snapshot = require('./snapshotService');

async function getVersion(client, versionId) {
  const { rows } = await client.query(
    `SELECT id, version, status, installed_at, applied_at
     FROM app_versions WHERE id=$1`, [versionId]);
  return rows[0] || null;
}

async function getAppliedMigrations(client, versionId) {
  const { rows } = await client.query(
    `SELECT id, name, down_sql, checksum
     FROM schema_migrations
     WHERE version_id=$1 AND applied_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY applied_at DESC, id DESC`, [versionId]);
  return rows;
}

// Dry-run validation. Does not mutate state.
async function validate(versionId) {
  const db = getDb();
  const v = await getVersion(db, versionId);
  if (!v) return { ok: false, reason: 'version_not_found' };
  if (v.status !== 'installed') {
    return { ok: false, reason: 'version_not_active', currentStatus: v.status };
  }

  const snap = await snapshot.getSnapshotForVersion(versionId);
  if (!snap) return { ok: false, reason: 'missing_snapshot' };

  if (!fs.existsSync(snap.file_path)) {
    return { ok: false, reason: 'snapshot_file_missing', file: snap.file_path };
  }
  const fileCheck = await snapshot.validateSnapshotFile(snap);
  if (!fileCheck.ok) return { ok: false, reason: fileCheck.reason };

  return {
    ok: true,
    snapshotId: snap.id,
    snapshotCreatedAt: snap.created_at,
    snapshotSchemaHash: snap.schema_hash,
    preVersion: snap.pre_version
  };
}

async function rollback(versionId, userId) {
  // Hard safety checks — run before we touch any state
  const pre = await validate(versionId);
  if (!pre.ok) {
    const e = new Error(`Rollback blocked: ${pre.reason}`);
    e.status = pre.reason === 'snapshot_file_missing' ? 410
            : pre.reason === 'version_not_found'      ? 404
            :                                           409;
    e.details = pre;
    throw e;
  }

  const db = getDb();
  const snap = await snapshot.getSnapshotForVersion(versionId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Run down migrations (reverse apply order)
    const migs = await getAppliedMigrations(client, versionId);
    for (const m of migs) {
      await client.query(m.down_sql);
      await client.query(
        `UPDATE schema_migrations SET rolled_back_at=NOW() WHERE id=$1`, [m.id]);
    }

    // 2. Schema-drift detection.
    //    After running down migrations, the schema MUST match the snapshot
    //    schema-hash captured before the update was applied. If not, someone
    //    modified the DB schema outside the managed migration flow → abort.
    const currentHash = await snapshot.schemaHash(client);
    if (currentHash !== snap.schema_hash) {
      const e = new Error(
        `Rollback blocked: schema_mismatch (expected ${snap.schema_hash}, got ${currentHash})`);
      e.status = 409;
      e.details = {
        reason: 'schema_mismatch',
        expectedHash: snap.schema_hash,
        currentHash
      };
      throw e;
    }

    // 3. Restore snapshot data (file + checksum verified, FK-safe transactional)
    const restored = await snapshot.restoreWithinTransaction(client, snap);

    // 4. Mark version as rolled back
    await client.query(
      `UPDATE app_versions
         SET status='rolled_back', rolled_back_at=NOW(), applied_at=NULL
       WHERE id=$1`, [versionId]);

    await client.query('COMMIT');

    return {
      versionId,
      snapshotId: snap.id,
      rolledBackMigrations: migs.length,
      restoredTables: restored.tables,
      completedAt: new Date().toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { validate, rollback };
