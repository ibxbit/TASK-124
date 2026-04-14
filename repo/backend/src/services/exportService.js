'use strict';

const fs = require('fs');
const path = require('path');
// ExcelJS is lazy-loaded: heavy module (~6 MB), only needed for xlsx exports.
let _ExcelJS = null;
function getExcelJS() { return _ExcelJS || (_ExcelJS = require('exceljs')); }
const { getDb } = require('../db/pool');
const { buildStreamQuery, MAX_LIMIT } = require('./queryBuilder');
const { validateExport, MAX_ROWS } = require('./exportValidation');
const { COLUMNS, csvEscape, toCsv } = require('./exportFormat');
const config = require('../config');

if (!fs.existsSync(config.exportDir)) fs.mkdirSync(config.exportDir, { recursive: true });

function writeCsv(filePath, headerLines, columns, rows) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    stream.on('error', reject);
    stream.on('finish', resolve);
    for (const line of headerLines) stream.write(line + '\r\n');
    stream.write('\r\n');
    stream.write(columns.map(csvEscape).join(',') + '\r\n');
    for (const r of rows) {
      stream.write(columns.map(c => csvEscape(r[c])).join(',') + '\r\n');
    }
    stream.end();
  });
}

async function writeXlsx(filePath, headerLines, columns, rows) {
  const wb = new (getExcelJS()).stream.xlsx.WorkbookWriter({ filename: filePath });
  const ws = wb.addWorksheet('Export');
  for (const line of headerLines) ws.addRow([line]).commit();
  ws.addRow([]).commit();
  ws.addRow(columns).commit();
  for (const r of rows) ws.addRow(columns.map(c => r[c])).commit();
  await ws.commit();
  await wb.commit();
}

// ─── Job orchestration ──────────────────────────────────────────────────────

async function createJob(userId, format, definition) {
  // Hard validation BEFORE persisting or scheduling anything.
  const validated = await validateExport(definition, format, {
    reportType: 'Analytics Export'
  });

  const { rows } = await getDb().query(
    `INSERT INTO export_jobs (user_id, format, definition, status)
     VALUES ($1,$2,$3,'pending')
     RETURNING id, status, created_at`,
    [userId, format, definition]);
  const job = rows[0];

  setImmediate(() => runJob(job.id, format, definition, validated).catch(() => {}));
  return { ...job, rowCount: validated.rowCount };
}

async function runJob(jobId, format, definition, validated) {
  const db = getDb();
  try {
    await db.query(`UPDATE export_jobs SET status='running' WHERE id=$1`, [jobId]);

    const { sql, params } = buildStreamQuery(definition, MAX_LIMIT);
    const { rows } = await db.query(sql, params);

    // Row-count drift guard: reality must match what validateExport pre-counted
    // (within a small tolerance for concurrent inserts).
    if (rows.length > MAX_ROWS) {
      throw new Error(
        `Row count drift: ${rows.length} > ${MAX_ROWS}; ` +
        `another insert raced the export. Re-run with tighter filters.`);
    }

    const filename = `export_${jobId}_${Date.now()}.${format}`;
    const filePath = path.join(config.exportDir, filename);

    if (format === 'csv') await writeCsv(filePath, validated.headerLines, COLUMNS, rows);
    else                  await writeXlsx(filePath, validated.headerLines, COLUMNS, rows);

    await db.query(
      `UPDATE export_jobs
       SET status='completed', row_count=$1, file_path=$2, completed_at=NOW()
       WHERE id=$3`,
      [rows.length, filePath, jobId]);
  } catch (err) {
    await db.query(
      `UPDATE export_jobs SET status='failed', error=$1, completed_at=NOW() WHERE id=$2`,
      [err.message, jobId]);
  }
}

async function getJob(userId, id) {
  const { rows } = await getDb().query(
    `SELECT id, format, status, row_count, file_path, error, created_at, completed_at
     FROM export_jobs WHERE user_id=$1 AND id=$2`, [userId, id]);
  return rows[0] || null;
}

async function listJobs(userId) {
  const { rows } = await getDb().query(
    `SELECT id, format, status, row_count, created_at, completed_at
     FROM export_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]);
  return rows;
}

module.exports = {
  createJob, getJob, listJobs,
  // exported for tests
  toCsv, writeCsv, writeXlsx, csvEscape, COLUMNS
};
