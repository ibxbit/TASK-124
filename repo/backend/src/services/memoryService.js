'use strict';

// Long-term memory monitor.
//
//  • Samples process.memoryUsage() every SAMPLE_INTERVAL_MS.
//  • Maintains a boot-baseline and rolling 30-day min/max.
//  • Emits a 'warning' memory_alert the first time growth breaches
//    WARN_GROWTH (default 20%) and a 'critical' alert at CRITICAL_GROWTH (50%).
//  • Throttles alerts so we don't flood the alerts table every 5 minutes.
//  • Exposes pure helpers (computeGrowth) for unit testing.
//
// Also runs two background "housekeeping" jobs tied to memory hygiene:
//
//  • pruneCheckpoints  — deletes checkpoint rows older than 30 days except
//    the newest per (kind, key). Keeps the hot table bounded and the
//    checkpointService.latest() index-only scan fast.
//  • pruneMemorySamples — keeps 90 days of samples.

const { getDb } = require('../db/pool');

const SAMPLE_INTERVAL_MS   = 5 * 60 * 1000;       // 5 minutes
const HOUSEKEEPING_EVERY_N_SAMPLES = 12;          // once per hour
const WARN_GROWTH     = 0.20;                     // 20%
const CRITICAL_GROWTH = 0.50;                     // 50%
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;         // 1 alert per scope per hour

// In-process state
let sampleTimer = null;
let sampleCount = 0;
let baselineRss = null;                           // first sample at boot
const lastAlertAt = new Map();                    // scope → timestamp

// ─── Pure helpers (testable) ────────────────────────────────────────────────

function computeGrowth(baseline, current) {
  if (!baseline || baseline <= 0) return 0;
  return (current - baseline) / baseline;
}

function severityFor(growth) {
  if (growth >= CRITICAL_GROWTH) return 'critical';
  if (growth >  WARN_GROWTH)     return 'warning';
  return null;
}

// ─── Alert writer (throttled) ───────────────────────────────────────────────

async function maybeAlert(scope, growth, rss, baseline, note) {
  const severity = severityFor(growth);
  if (!severity) return false;

  const now = Date.now();
  const last = lastAlertAt.get(scope) || 0;
  if (now - last < ALERT_COOLDOWN_MS) return false;

  try {
    await getDb().query(
      `INSERT INTO memory_alerts (severity, growth, rss_bytes, baseline, scope, note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [severity, growth.toFixed(6), rss, baseline, scope, note || null]);
    lastAlertAt.set(scope, now);
    console.warn(
      `[memory] ${severity.toUpperCase()} ${scope}: growth=${(growth * 100).toFixed(2)}% ` +
      `rss=${rss} baseline=${baseline}`);
    return true;
  } catch (err) {
    console.error('[memory] alert insert failed:', err.message);
    return false;
  }
}

// ─── Sampling ───────────────────────────────────────────────────────────────

async function sample() {
  const m = process.memoryUsage();
  if (baselineRss == null) baselineRss = m.rss;
  sampleCount++;

  // Persist sample
  try {
    await getDb().query(
      `INSERT INTO memory_samples (rss_bytes, heap_used, heap_total, external)
       VALUES ($1,$2,$3,$4)`,
      [m.rss, m.heapUsed, m.heapTotal, m.external]);
  } catch (err) {
    console.error('[memory] sample insert failed:', err.message);
  }

  // Growth since boot
  const sinceBootGrowth = computeGrowth(baselineRss, m.rss);
  await maybeAlert('since_boot', sinceBootGrowth, m.rss, baselineRss,
    `rss since boot up ${(sinceBootGrowth * 100).toFixed(1)}% over ${sampleCount} samples`);

  // Rolling 30-day growth — min→max
  try {
    const { rows } = await getDb().query(
      `SELECT MIN(rss_bytes)::bigint AS min30d, MAX(rss_bytes)::bigint AS max30d
       FROM memory_samples WHERE sampled_at >= NOW() - INTERVAL '30 days'`);
    const min30 = Number((rows[0] && rows[0].min30d) || m.rss);
    const max30 = Number((rows[0] && rows[0].max30d) || m.rss);
    const growth30d = computeGrowth(min30, max30);
    await maybeAlert('30d', growth30d, max30, min30,
      `30d rss spread: min=${min30} max=${max30}`);
  } catch (err) {
    console.error('[memory] 30d growth check failed:', err.message);
  }

  // Housekeeping every hour
  if (sampleCount % HOUSEKEEPING_EVERY_N_SAMPLES === 0) {
    housekeeping().catch(err => console.error('[memory] housekeeping:', err.message));
  }
}

// ─── Housekeeping jobs (keep hot tables bounded) ────────────────────────────

async function pruneCheckpoints() {
  const db = getDb();
  const { rowCount } = await db.query(
    `DELETE FROM checkpoints
     WHERE checkpoint_at < NOW() - INTERVAL '30 days'
       AND id NOT IN (
         SELECT DISTINCT ON (kind, key) id
         FROM checkpoints ORDER BY kind, key, sequence DESC NULLS LAST, checkpoint_at DESC
       )`);
  return { deleted: rowCount };
}

async function pruneMemorySamples() {
  const { rowCount } = await getDb().query(
    `DELETE FROM memory_samples WHERE sampled_at < NOW() - INTERVAL '90 days'`);
  return { deleted: rowCount };
}

async function housekeeping() {
  const [cp, ms] = await Promise.all([pruneCheckpoints(), pruneMemorySamples()]);
  return { checkpoints: cp.deleted, memorySamples: ms.deleted };
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

function start() {
  if (sampleTimer) return;
  sample();
  sampleTimer = setInterval(sample, SAMPLE_INTERVAL_MS);
}

function stop() {
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
}

// ─── Public read API ────────────────────────────────────────────────────────

async function status() {
  const m = process.memoryUsage();
  const sinceBoot = computeGrowth(baselineRss, m.rss);

  const { rows } = await getDb().query(
    `SELECT MIN(rss_bytes)::bigint AS min30d,
            MAX(rss_bytes)::bigint AS max30d,
            COUNT(*)::int          AS samples
     FROM memory_samples WHERE sampled_at >= NOW() - INTERVAL '30 days'`);
  const min30 = Number((rows[0] && rows[0].min30d) || m.rss);
  const max30 = Number((rows[0] && rows[0].max30d) || m.rss);
  const growth30d = computeGrowth(min30, max30);

  return {
    current: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external },
    baselineRss,
    sampleCount,
    sinceBoot: {
      growth: sinceBoot,
      overThreshold: sinceBoot > WARN_GROWTH,
      severity: severityFor(sinceBoot)
    },
    window30d: {
      samples: (rows[0] && rows[0].samples) || 0,
      min: min30, max: max30,
      growth: growth30d,
      overThreshold: growth30d > WARN_GROWTH,
      severity: severityFor(growth30d)
    },
    thresholds: { warn: WARN_GROWTH, critical: CRITICAL_GROWTH }
  };
}

async function recentAlerts(limit = 50) {
  const n = Math.min(Number(limit) || 50, 500);
  const { rows } = await getDb().query(
    `SELECT id, severity, growth, rss_bytes, baseline, scope, note, created_at
     FROM memory_alerts ORDER BY created_at DESC LIMIT $1`, [n]);
  return rows;
}

async function recordStartup(startedAt, readyAt, notes) {
  try {
    await getDb().query(
      `INSERT INTO startup_events (started_at, ready_at, duration_ms, pid, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [startedAt, readyAt, readyAt.getTime() - startedAt.getTime(), process.pid, notes || null]);
  } catch (err) {
    console.error('[memory] startup record failed:', err.message);
  }
}

module.exports = {
  start, stop, sample,
  status, recentAlerts, housekeeping,
  recordStartup,
  // exposed for testing
  computeGrowth, severityFor,
  WARN_GROWTH, CRITICAL_GROWTH, SAMPLE_INTERVAL_MS
};
