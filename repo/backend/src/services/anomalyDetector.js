'use strict';

const { getDb } = require('../db/pool');

const BURST_THRESHOLD = 20;
const BURST_WINDOW_MIN = 10;
const OUTLIER_STD_THRESHOLD = 2;

async function detectBurst(db, review) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM reviews
     WHERE device_id = $1
       AND created_at >= NOW() - INTERVAL '${BURST_WINDOW_MIN} minutes'`,
    [review.device_id]
  );
  const count = rows[0].c;
  if (count > BURST_THRESHOLD) {
    return { type: 'burst',
             details: { device_id: review.device_id, count,
                        window_minutes: BURST_WINDOW_MIN, threshold: BURST_THRESHOLD } };
  }
  return null;
}

async function detectRatingOutlier(db, review) {
  const { rows } = await db.query(
    `SELECT AVG(rating)::float AS mean,
            COALESCE(STDDEV_SAMP(rating), 0)::float AS std,
            COUNT(*)::int AS n
     FROM reviews WHERE status='visible'`);
  const { mean, std, n } = rows[0];
  if (!n || std === 0) return null;
  const z = Math.abs((review.rating - mean) / std);
  if (z > OUTLIER_STD_THRESHOLD) {
    return { type: 'rating_outlier',
             details: { rating: review.rating, mean, std, zScore: z,
                        threshold: OUTLIER_STD_THRESHOLD } };
  }
  return null;
}

async function runChecks(review) {
  const db = getDb();
  const findings = [];
  const burst = await detectBurst(db, review);
  if (burst) findings.push(burst);
  const outlier = await detectRatingOutlier(db, review);
  if (outlier) findings.push(outlier);

  for (const f of findings) {
    await db.query(
      `INSERT INTO review_anomalies (review_id, type, details) VALUES ($1,$2,$3)`,
      [review.id, f.type, f.details]);
  }
  return findings;
}

module.exports = { runChecks, BURST_THRESHOLD, BURST_WINDOW_MIN, OUTLIER_STD_THRESHOLD };
