'use strict';

const { getDb } = require('../db/pool');

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const GROWTH_THRESHOLD = 0.20;

let timer = null;
let baselineRss = null;

async function sample() {
  const m = process.memoryUsage();
  if (baselineRss == null) baselineRss = m.rss;
  try {
    await getDb().query(
      `INSERT INTO memory_samples (rss_bytes, heap_used, heap_total, external)
       VALUES ($1,$2,$3,$4)`,
      [m.rss, m.heapUsed, m.heapTotal, m.external]);
  } catch (err) {
    console.error('[memory] sample insert failed:', err.message);
  }
}

function startMemorySampling() {
  if (timer) return;
  sample();
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
}

function stopMemorySampling() { if (timer) { clearInterval(timer); timer = null; } }

async function recordStartup(startedAt, readyAt, notes) {
  try {
    await getDb().query(
      `INSERT INTO startup_events (started_at, ready_at, duration_ms, pid, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [startedAt, readyAt, readyAt.getTime() - startedAt.getTime(), process.pid, notes || null]);
  } catch (err) {
    console.error('[startup] record failed:', err.message);
  }
}

async function status() {
  const m = process.memoryUsage();
  const growth = baselineRss ? (m.rss - baselineRss) / baselineRss : 0;
  const { rows } = await getDb().query(
    `SELECT MIN(rss_bytes)::bigint AS min30d, MAX(rss_bytes)::bigint AS max30d
     FROM memory_samples WHERE sampled_at >= NOW() - INTERVAL '30 days'`);
  const min30 = Number((rows[0] && rows[0].min30d) || m.rss);
  const max30 = Number((rows[0] && rows[0].max30d) || m.rss);
  const growth30 = min30 ? (max30 - min30) / min30 : 0;
  return {
    current:          { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal },
    baselineRss,
    growthSinceBoot:  growth,
    growth30d:        { min: min30, max: max30, growth: growth30,
                        overThreshold: growth30 > GROWTH_THRESHOLD }
  };
}

module.exports = { startMemorySampling, stopMemorySampling, recordStartup, status, GROWTH_THRESHOLD };
