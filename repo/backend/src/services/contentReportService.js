'use strict';

const { getDb } = require('../db/pool');
const commentSvc = require('./commentService');

const OUTCOMES = new Set(['remove', 'warn', 'no_action']);

async function createReport(reporterId, opts) {
  const { targetType, targetId, reason } = opts;
  if (!targetType || !targetId || !reason) {
    const e = new Error('targetType, targetId, reason required'); e.status = 400; throw e;
  }
  const { rows } = await getDb().query(
    `INSERT INTO content_reports (reporter_id, target_type, target_id, reason)
     VALUES ($1,$2,$3,$4)
     RETURNING id, reporter_id, target_type, target_id, reason, status, created_at`,
    [reporterId, targetType, targetId, reason]);
  return rows[0];
}

async function listOpenReports() {
  const { rows } = await getDb().query(
    `SELECT id, reporter_id, target_type, target_id, reason, status, created_at
     FROM content_reports WHERE status='open' ORDER BY created_at ASC`);
  return rows;
}

async function resolveReport(reportId, moderatorId, outcome) {
  if (!OUTCOMES.has(outcome)) { const e = new Error('Invalid outcome'); e.status = 400; throw e; }
  const db = getDb();
  const { rows } = await db.query(
    `UPDATE content_reports
     SET status='resolved', outcome=$1, resolved_by=$2, resolved_at=NOW()
     WHERE id=$3 AND status='open'
     RETURNING id, target_type, target_id, outcome`,
    [outcome, moderatorId, reportId]);
  if (!rows.length) { const e = new Error('Report not found or already resolved'); e.status = 404; throw e; }
  const r = rows[0];
  if (outcome === 'remove' && r.target_type === 'comment') {
    await commentSvc.setStatus(r.target_id, 'removed');
  }
  return r;
}

async function submitAppeal(reportId, appellantId, reason) {
  const { rows } = await getDb().query(
    `INSERT INTO content_appeals (report_id, appellant_id, reason) VALUES ($1,$2,$3)
     RETURNING id, report_id, appellant_id, reason, status, created_at`,
    [reportId, appellantId, reason]);
  return rows[0];
}

async function listAppeals() {
  const { rows } = await getDb().query(
    `SELECT id, report_id, appellant_id, reason, status, created_at
     FROM content_appeals WHERE status='pending' ORDER BY created_at ASC`);
  return rows;
}

async function resolveAppeal(appealId, moderatorId, outcome) {
  if (!['upheld', 'overturned'].includes(outcome)) {
    const e = new Error('Invalid outcome'); e.status = 400; throw e;
  }
  const db = getDb();
  const { rows } = await db.query(
    `UPDATE content_appeals
     SET status=$1, resolved_by=$2, resolved_at=NOW()
     WHERE id=$3 AND status='pending'
     RETURNING id, report_id`,
    [outcome, moderatorId, appealId]);
  if (!rows.length) { const e = new Error('Appeal not found or already resolved'); e.status = 404; throw e; }
  const appeal = rows[0];
  if (outcome === 'overturned') {
    const rep = await db.query(
      `SELECT target_type, target_id, outcome FROM content_reports WHERE id=$1`,
      [appeal.report_id]);
    const r = rep.rows[0];
    if (r && r.outcome === 'remove' && r.target_type === 'comment') {
      await commentSvc.setStatus(r.target_id, 'visible');
    }
  }
  return appeal;
}

module.exports = {
  createReport, listOpenReports, resolveReport,
  submitAppeal, listAppeals, resolveAppeal
};
