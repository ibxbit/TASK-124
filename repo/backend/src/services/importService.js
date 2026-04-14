'use strict';

const { getDb } = require('../db/pool');
const parser = require('./importParser');
const paymentSvc = require('./paymentService');

async function importFile(opts) {
  const { source, format, filename, buffer, userId } = opts;
  if (!['wechat_pay', 'bank'].includes(source)) { const e = new Error('Invalid source'); e.status = 400; throw e; }
  if (!['csv', 'xlsx'].includes(format))        { const e = new Error('Invalid format'); e.status = 400; throw e; }

  const rows = await parser.parseBuffer(buffer, format, source);

  const db = getDb();
  const fileRes = await db.query(
    `INSERT INTO imported_files (source, format, filename, rows_total, imported_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [source, format, filename, rows.length, userId]);
  const fileId = fileRes.rows[0].id;

  let imported = 0;
  for (const row of rows) {
    const r = await paymentSvc.createPayment(row, { importedFileId: fileId });
    if (r) imported++;
  }

  await db.query(`UPDATE imported_files SET rows_imported=$1 WHERE id=$2`, [imported, fileId]);
  return { fileId, rowsTotal: rows.length, rowsImported: imported, rowsSkipped: rows.length - imported };
}

module.exports = { importFile };
