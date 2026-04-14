'use strict';

// Stable-key canonical JSON + SHA-256 checksum helpers.
// Used at both WRITE-time (checkpointService) and READ-time (recoveryService)
// so integrity verification is deterministic across platforms and node versions.

const crypto = require('crypto');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function checksumOf(payload) {
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

// Returns { ok:true } or { ok:false, reason, expected, actual }.
function verify(row) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.checksum) return { ok: false, reason: 'missing_checksum' };
  const actual = checksumOf(row.payload);
  if (actual !== row.checksum) {
    return { ok: false, reason: 'checksum_mismatch', expected: row.checksum, actual };
  }
  return { ok: true };
}

module.exports = { canonicalJson, checksumOf, verify };
