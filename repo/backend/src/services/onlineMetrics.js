'use strict';

const { getDb } = require('../db/pool');
const { twoSidedZTest } = require('./stats');

const MIN_IMPRESSIONS = 1000;
const ALPHA = 0.05;

async function getBucketCounts(experimentId, version) {
  const { rows } = await getDb().query(
    `SELECT bucket, event_type, COUNT(*)::int AS c
     FROM experiment_events
     WHERE experiment_id=$1 AND version=$2
     GROUP BY bucket, event_type`,
    [experimentId, version]
  );
  const byBucket = {};
  for (const r of rows) {
    byBucket[r.bucket] = byBucket[r.bucket] || { impressions: 0, clicks: 0, conversions: 0 };
    if (r.event_type === 'impression') byBucket[r.bucket].impressions = r.c;
    if (r.event_type === 'click')      byBucket[r.bucket].clicks      = r.c;
    if (r.event_type === 'conversion') byBucket[r.bucket].conversions = r.c;
  }
  return byBucket;
}

async function get7DayRetention(experimentId, version) {
  const { rows } = await getDb().query(
    `WITH firsts AS (
       SELECT user_id, bucket, MIN(occurred_at) AS first_ts
       FROM experiment_events
       WHERE experiment_id=$1 AND version=$2
       GROUP BY user_id, bucket
     ),
     returns AS (
       SELECT DISTINCT f.user_id, f.bucket
       FROM firsts f
       JOIN experiment_events e
         ON e.user_id=f.user_id AND e.experiment_id=$1 AND e.version=$2
        AND e.occurred_at >  f.first_ts
        AND e.occurred_at <= f.first_ts + INTERVAL '7 days'
     )
     SELECT f.bucket,
            COUNT(DISTINCT f.user_id)::int AS cohort,
            COUNT(DISTINCT r.user_id)::int AS retained
     FROM firsts f
     LEFT JOIN returns r ON r.user_id=f.user_id AND r.bucket=f.bucket
     GROUP BY f.bucket`,
    [experimentId, version]
  );
  const out = {};
  for (const r of rows) {
    out[r.bucket] = { cohort: r.cohort, retained: r.retained,
                      rate: r.cohort ? r.retained / r.cohort : 0 };
  }
  return out;
}

async function liftSeries(experimentId, version, bins = 20) {
  const { rows } = await getDb().query(
    `WITH bounds AS (
       SELECT MIN(occurred_at) AS lo, MAX(occurred_at) AS hi
       FROM experiment_events WHERE experiment_id=$1 AND version=$2
     )
     SELECT bucket,
            WIDTH_BUCKET(
              EXTRACT(EPOCH FROM occurred_at),
              EXTRACT(EPOCH FROM (SELECT lo FROM bounds)),
              EXTRACT(EPOCH FROM (SELECT hi FROM bounds)) + 1,
              $3
            ) AS bin,
            event_type,
            COUNT(*)::int AS c
     FROM experiment_events
     WHERE experiment_id=$1 AND version=$2
     GROUP BY bucket, bin, event_type
     ORDER BY bucket, bin`,
    [experimentId, version, bins]
  );

  const series = {};
  for (const r of rows) {
    series[r.bucket] = series[r.bucket]
      || Array.from({ length: bins }, () => ({ impressions: 0, clicks: 0 }));
    if (r.event_type === 'impression') series[r.bucket][r.bin - 1].impressions += r.c;
    if (r.event_type === 'click')      series[r.bucket][r.bin - 1].clicks      += r.c;
  }
  for (const bucket of Object.keys(series)) {
    let ci = 0, ii = 0;
    series[bucket] = series[bucket].map((pt, idx) => {
      ii += pt.impressions; ci += pt.clicks;
      return { bin: idx + 1, cumulativeCtr: ii ? ci / ii : 0 };
    });
  }
  return series;
}

async function computeMetrics(experimentId, version, opts) {
  const alpha = (opts && opts.alpha) ? Number(opts.alpha) : ALPHA;
  const counts    = await getBucketCounts(experimentId, version);
  const retention = await get7DayRetention(experimentId, version);
  const lift      = await liftSeries(experimentId, version);

  const bucketNames = Object.keys(counts);
  const warnings = [];
  const perBucket = {};

  for (const b of bucketNames) {
    const c = counts[b];
    perBucket[b] = {
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      ctr:            c.impressions ? c.clicks      / c.impressions : 0,
      conversionRate: c.impressions ? c.conversions / c.impressions : 0,
      retention7d:    (retention[b] && retention[b].rate) || 0
    };
    if (c.impressions < MIN_IMPRESSIONS) {
      warnings.push(`insufficient sample: bucket "${b}" has ${c.impressions} impressions (<${MIN_IMPRESSIONS})`);
    }
  }

  const significance = {};
  if (bucketNames.length >= 2) {
    const control = bucketNames[0];
    const cCtrl = counts[control];
    for (const b of bucketNames.slice(1)) {
      const cVar = counts[b];
      significance[`${b}_vs_${control}`] = {
        ctr:            twoSidedZTest(cVar.clicks,      cVar.impressions, cCtrl.clicks,      cCtrl.impressions, alpha),
        conversionRate: twoSidedZTest(cVar.conversions, cVar.impressions, cCtrl.conversions, cCtrl.impressions, alpha)
      };
    }
  }

  return { experimentId, version, alpha, buckets: perBucket, significance, warnings, lift };
}

module.exports = { computeMetrics, MIN_IMPRESSIONS, ALPHA };
