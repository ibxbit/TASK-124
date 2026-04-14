'use strict';

// Anti-spam system.
//
//   • Sliding-window rate limiter (recordEvent + countInWindow + checkLimit)
//   • Device fingerprinting: recordDeviceEvent, deviceRiskScore
//   • Duplicate-content detection via sha256 of normalized text
//   • Per-user spam score with exponential decay; block above BLOCK_THRESHOLD
//
// Every public function is safe to call under load: all writes are a single
// parameterized SQL statement, all reads hit a supporting index.

const crypto = require('crypto');
const { getDb } = require('../db/pool');

// ─── Tunables ───────────────────────────────────────────────────────────────

const SCORE_HALF_LIFE_SEC = 24 * 60 * 60;   // 24h decay half-life
const BLOCK_THRESHOLD     = 100;
const DUPLICATE_WINDOW_SEC = 24 * 60 * 60;  // scan last 24h for duplicates
const DEVICE_BURST_THRESHOLD = 10;          // >10 actions in 5 min is "bursty"
const DEVICE_BURST_WINDOW_SEC = 5 * 60;

const SIGNAL_WEIGHTS = {
  duplicate_content:  30,
  rate_exceeded:      15,
  device_burst:       20,
  sensitive_word:     25,
  blacklisted_user: 1000,   // deliberate hard block
  ok:                  0
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Normalize before hashing so whitespace / case / punctuation noise
// doesn't let a near-identical post evade duplicate detection.
function normalizeForHash(text) {
  return String(text || '')
    .toLowerCase()
    // Collapse punctuation AND whitespace into single spaces so e.g.
    // "www.example.com" becomes "www example com" — identical to the same
    // phrase with spaces. Prevents punctuation-only evasion.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function contentHash(text) {
  const n = normalizeForHash(text);
  return n ? sha256(n) : null;
}

// Exponential decay: score * 2^(-Δt / halfLife)
function decayScore(previous, ageSec, halfLife = SCORE_HALF_LIFE_SEC) {
  if (!previous) return 0;
  const factor = Math.pow(2, -ageSec / halfLife);
  return previous * factor;
}

// ─── Sliding window rate limiter ────────────────────────────────────────────

async function recordEvent(bucketKey) {
  await getDb().query(
    `INSERT INTO rate_limit_events (bucket_key) VALUES ($1)`, [bucketKey]);
}

async function countInWindow(bucketKey, windowSec) {
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM rate_limit_events
     WHERE bucket_key = $1 AND at > NOW() - ($2 || ' seconds')::interval`,
    [bucketKey, String(windowSec)]);
  return rows[0].c;
}

// Returns { ok:true } if under the limit (and records the event), otherwise
// { ok:false, count, limit, windowSec } — caller decides how to respond.
async function checkLimit(bucketKey, limit, windowSec, { dryRun = false } = {}) {
  const current = await countInWindow(bucketKey, windowSec);
  if (current >= limit) return { ok: false, count: current, limit, windowSec };
  if (!dryRun) await recordEvent(bucketKey);
  return { ok: true, count: current + (dryRun ? 0 : 1), limit, windowSec };
}

// ─── Device fingerprint tracking ────────────────────────────────────────────

async function recordDeviceEvent({ deviceId, userId, kind, signal = 'ok', metadata = {} }) {
  if (!deviceId || !userId || !kind) return;
  await getDb().query(
    `INSERT INTO device_events (device_id, user_id, kind, signal, metadata)
     VALUES ($1,$2,$3,$4,$5)`,
    [deviceId, String(userId), kind, signal, metadata]);
}

// Burst detection: same device, N actions inside window.
async function isDeviceBursting(deviceId,
  threshold = DEVICE_BURST_THRESHOLD,
  windowSec = DEVICE_BURST_WINDOW_SEC) {
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM device_events
     WHERE device_id=$1 AND at > NOW() - ($2 || ' seconds')::interval`,
    [deviceId, String(windowSec)]);
  return rows[0].c > threshold;
}

// Historical abuse: total non-ok signals from this device in the last 30 days.
async function deviceRiskScore(deviceId) {
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::int AS abuse
     FROM device_events
     WHERE device_id=$1 AND signal <> 'ok'
       AND at > NOW() - INTERVAL '30 days'`,
    [deviceId]);
  return rows[0].abuse;
}

// ─── Duplicate content detection ────────────────────────────────────────────

async function detectDuplicate({ userId, targetType, body }) {
  const hash = contentHash(body);
  if (!hash) return { duplicate: false, hash: null };

  const { rows } = await getDb().query(
    `SELECT id, created_at FROM content_hashes
     WHERE user_id=$1 AND target_type=$2 AND content_hash=$3
       AND created_at > NOW() - ($4 || ' seconds')::interval
     LIMIT 1`,
    [String(userId), targetType, hash, String(DUPLICATE_WINDOW_SEC)]);

  return {
    duplicate: rows.length > 0,
    hash,
    previousId: rows[0] ? rows[0].id : null,
    previousAt: rows[0] ? rows[0].created_at : null
  };
}

async function recordContentHash({ userId, targetType, body }) {
  const hash = contentHash(body);
  if (!hash) return null;
  const { rows } = await getDb().query(
    `INSERT INTO content_hashes (user_id, target_type, content_hash)
     VALUES ($1,$2,$3)
     RETURNING id, content_hash, created_at`,
    [String(userId), targetType, hash]);
  return rows[0];
}

// ─── Spam scoring + block gate ──────────────────────────────────────────────

async function getScore(userId) {
  const { rows } = await getDb().query(
    `SELECT score, updated_at FROM spam_scores WHERE user_id=$1`,
    [String(userId)]);
  if (!rows.length) return { score: 0, blocked: false, updatedAt: null };
  const ageSec = (Date.now() - new Date(rows[0].updated_at).getTime()) / 1000;
  const current = decayScore(Number(rows[0].score), ageSec);
  return {
    score: current,
    blocked: current >= BLOCK_THRESHOLD,
    updatedAt: rows[0].updated_at
  };
}

// Apply a signal: decay the existing score, then add the signal's weight.
async function applySignal(userId, signal, metadata = {}) {
  const delta = SIGNAL_WEIGHTS[signal];
  if (delta == null) return { score: null, skipped: true };

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const prev = await client.query(
      `SELECT score, updated_at FROM spam_scores WHERE user_id=$1 FOR UPDATE`,
      [String(userId)]);
    let next = delta;
    if (prev.rows.length) {
      const ageSec = (Date.now() - new Date(prev.rows[0].updated_at).getTime()) / 1000;
      next = decayScore(Number(prev.rows[0].score), ageSec) + delta;
    }
    await client.query(
      `INSERT INTO spam_scores (user_id, score, last_event, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET score=EXCLUDED.score, last_event=EXCLUDED.last_event, updated_at=NOW()`,
      [String(userId), next, signal]);
    await client.query('COMMIT');
    return { score: next, blocked: next >= BLOCK_THRESHOLD, signal, delta };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

// ─── High-level orchestration for comment-create path ───────────────────────
//
// Returns:
//   { action:'allow' }                    → caller may proceed
//   { action:'block', reason, status, details }
//
// Side effects: records a device event + applies a signal to the user's score
// on any detected abuse. Sliding-window event is only recorded on allow.

async function evaluateCommentCreate({ userId, deviceId, targetType, body, throttlePolicy }) {
  // 1. Hard block if user is already past the spam threshold.
  const gate = await getScore(userId);
  if (gate.blocked) {
    await recordDeviceEvent({ deviceId, userId, kind: 'comment', signal: 'blocked' });
    return {
      action: 'block', reason: 'spam_blocked', status: 403,
      details: { score: gate.score }
    };
  }

  const bucket = `user:${userId}:comment`;
  const limit      = (throttlePolicy && throttlePolicy.max_count)      || 30;
  const windowSec  = (throttlePolicy && throttlePolicy.window_seconds) || 3600;

  // 2. Sliding-window rate limit (dry-run; we only consume a token on allow).
  const rl = await checkLimit(bucket, limit, windowSec, { dryRun: true });
  if (!rl.ok) {
    await applySignal(userId, 'rate_exceeded');
    await recordDeviceEvent({ deviceId, userId, kind: 'comment', signal: 'rate_exceeded',
      metadata: { count: rl.count, limit, windowSec } });
    return {
      action: 'block', reason: 'rate_limit',       status: 429,
      details: { count: rl.count, limit, windowSec }
    };
  }

  // 3. Device burst detection.
  if (deviceId && await isDeviceBursting(deviceId)) {
    await applySignal(userId, 'device_burst');
    await recordDeviceEvent({ deviceId, userId, kind: 'comment', signal: 'device_burst' });
    return {
      action: 'block', reason: 'device_burst', status: 429,
      details: { thresholdSeconds: DEVICE_BURST_WINDOW_SEC, threshold: DEVICE_BURST_THRESHOLD }
    };
  }

  // 4. Duplicate content detection.
  const dup = await detectDuplicate({ userId, targetType, body });
  if (dup.duplicate) {
    await applySignal(userId, 'duplicate_content');
    await recordDeviceEvent({ deviceId, userId, kind: 'comment', signal: 'duplicate_content',
      metadata: { previousId: dup.previousId } });
    return {
      action: 'block', reason: 'duplicate_content', status: 409,
      details: { previousAt: dup.previousAt }
    };
  }

  // 5. Allow: consume rate-limit token, record content hash + device event.
  await recordEvent(bucket);
  await recordContentHash({ userId, targetType, body });
  await recordDeviceEvent({ deviceId, userId, kind: 'comment', signal: 'ok' });
  return { action: 'allow', contentHash: dup.hash };
}

module.exports = {
  // core primitives
  recordEvent, countInWindow, checkLimit,
  recordDeviceEvent, isDeviceBursting, deviceRiskScore,
  detectDuplicate, recordContentHash,
  getScore, applySignal,
  // orchestrator
  evaluateCommentCreate,
  // pure helpers (tested directly)
  normalizeForHash, contentHash, decayScore,
  // constants
  SCORE_HALF_LIFE_SEC, BLOCK_THRESHOLD, SIGNAL_WEIGHTS,
  DUPLICATE_WINDOW_SEC, DEVICE_BURST_THRESHOLD, DEVICE_BURST_WINDOW_SEC
};
