'use strict';

const { getDb } = require('../db/pool');

async function writeAuditLog(entry) {
  try {
    await getDb().query(
      `INSERT INTO audit_log
         (user_id, role, action, resource, method, status, reason, ip, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())`,
      [entry.userId, entry.role, entry.action, entry.resource,
       entry.method, entry.status, entry.reason, entry.ip]
    );
  } catch (err) {
    // Never block a request because of audit-log failure; just log
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = { writeAuditLog };
