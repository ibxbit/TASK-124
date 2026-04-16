'use strict';

// Deep versioning lifecycle: import a zip package → apply → attempt rollback validate.
// Exercises updateService (importPackage, applyVersion) and rollbackService (validate).

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { getApp, getToken, authHeader, closeApp, getDb } = require('../helpers');

test.after(closeApp);

// Monotonically increasing version to always be newer than installed.
const VER_BASE = Math.floor(Date.now() / 1000);
let seq = 0;
function nextVer() { return `${VER_BASE}.${seq++}.0`; }

function buildVersionZip(version, upSql = 'SELECT 1;', downSql = 'SELECT 1;') {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version })));
  zip.addFile('migrations/up/001_test.sql', Buffer.from(upSql));
  zip.addFile('migrations/down/001_test.sql', Buffer.from(downSql));
  return zip.toBuffer();
}

test('updateService.importPackage: valid zip with manifest + migrations', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  const ver = nextVer();
  const buf = buildVersionZip(ver, 'CREATE TABLE IF NOT EXISTS _test_up(x int);', 'DROP TABLE IF EXISTS _test_up;');
  const result = await updates.importPackage({ filename: 'test.zip', buffer: buf, userId: 1 });
  assert.ok(result.id);
  assert.equal(result.version, ver);
  assert.equal(result.status, 'imported');
  assert.ok(result.migrations.includes('001_test'));
});

test('updateService.importPackage: rejects invalid zip', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  await assert.rejects(
    updates.importPackage({ filename: 'bad.zip', buffer: Buffer.from('not a zip'), userId: 1 }),
    (err) => err.status === 400
  );
});

test('updateService.importPackage: rejects missing manifest.json', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('hello'));
  await assert.rejects(
    updates.importPackage({ filename: 'x.zip', buffer: zip.toBuffer(), userId: 1 }),
    (err) => err.status === 400
  );
});

test('updateService.importPackage: rejects manifest without version field', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ description: 'no version' })));
  await assert.rejects(
    updates.importPackage({ filename: 'x.zip', buffer: zip.toBuffer(), userId: 1 }),
    (err) => err.status === 400
  );
});

test('updateService.importPackage: rejects up migration without matching down', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  const ver = nextVer();
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version: ver })));
  zip.addFile('migrations/up/001_test.sql', Buffer.from('SELECT 1;'));
  await assert.rejects(
    updates.importPackage({ filename: 'x.zip', buffer: zip.toBuffer(), userId: 1 }),
    (err) => err.status === 400
  );
});

test('updateService.applyVersion: applies an imported version', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  const db = getDb();
  const ver = nextVer();
  const buf = buildVersionZip(ver, 'SELECT 1;', 'SELECT 1;');
  const imported = await updates.importPackage({ filename: 'apply.zip', buffer: buf, userId: 1 });
  const result = await updates.applyVersion(imported.id, 1);
  assert.ok(result);
  const { rows } = await db.query('SELECT status FROM app_versions WHERE id=$1', [imported.id]);
  assert.equal(rows[0].status, 'installed');
});

test('updateService.applyVersion: 404 for non-existent', async () => {
  await getApp();
  const updates = require('../../backend/src/services/updateService');
  await assert.rejects(
    updates.applyVersion(999999, 1),
    (err) => err.status === 404
  );
});

test('rollbackService.validate: on installed version', async () => {
  await getApp();
  const rb = require('../../backend/src/services/rollbackService');
  const db = getDb();
  const { rows } = await db.query(
    "SELECT id FROM app_versions WHERE status='installed' ORDER BY installed_at DESC LIMIT 1");
  if (!rows.length) return;
  const result = await rb.validate(rows[0].id);
  assert.ok(typeof result === 'object');
});
