'use strict';

// Offline recommendation evaluation: Precision, Recall, NDCG@10, Coverage, Diversity
const { getDb } = require('../db/pool');

const K = 10;

function precisionRecall(recs, truth) {
  const topK = recs.slice(0, K);
  const hit = topK.filter(r => truth.has(r)).length;
  const precision = topK.length ? hit / topK.length : 0;
  const recall    = truth.size ? hit / truth.size : 0;
  return { precision, recall };
}

function ndcgAtK(recs, truth) {
  const topK = recs.slice(0, K);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (truth.has(topK[i])) dcg += 1 / Math.log2(i + 2);
  }
  const idealHits = Math.min(truth.size, K);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

function diversity(items) {
  const topK = items.slice(0, K);
  if (topK.length < 2) return 0;
  let samePairs = 0, totalPairs = 0;
  for (let i = 0; i < topK.length; i++) {
    for (let j = i + 1; j < topK.length; j++) {
      totalPairs++;
      if (topK[i].category && topK[i].category === topK[j].category) samePairs++;
    }
  }
  return totalPairs ? 1 - samePairs / totalPairs : 0;
}

async function evaluateRun(runId) {
  const db = getDb();
  const [recsRes, gtRes, catalogRes] = await Promise.all([
    db.query(
      `SELECT user_id, rank, item_id, category
       FROM recommendation_items WHERE run_id=$1
       ORDER BY user_id, rank`, [runId]),
    db.query(
      `SELECT user_id, item_id FROM recommendation_ground_truth WHERE run_id=$1`, [runId]),
    db.query(`SELECT COUNT(*)::int AS total FROM catalog_items`)
  ]);

  const catalogTotal = catalogRes.rows[0].total;

  const recsByUser = new Map();
  for (const r of recsRes.rows) {
    if (!recsByUser.has(r.user_id)) recsByUser.set(r.user_id, []);
    recsByUser.get(r.user_id).push({ item_id: r.item_id, category: r.category });
  }

  const truthByUser = new Map();
  for (const g of gtRes.rows) {
    if (!truthByUser.has(g.user_id)) truthByUser.set(g.user_id, new Set());
    truthByUser.get(g.user_id).add(g.item_id);
  }

  let sumP = 0, sumR = 0, sumN = 0, sumDiv = 0, users = 0;
  const recommendedItems = new Set();

  for (const [userId, items] of recsByUser) {
    const truth = truthByUser.get(userId) || new Set();
    const ids = items.map(i => i.item_id);
    const { precision, recall } = precisionRecall(ids, truth);
    sumP += precision;
    sumR += recall;
    sumN += ndcgAtK(ids, truth);
    sumDiv += diversity(items);
    users++;
    for (const id of ids) recommendedItems.add(id);
  }

  const n = Math.max(users, 1);
  return {
    runId,
    users,
    precision: sumP / n,
    recall:    sumR / n,
    ndcg10:    sumN / n,
    coverage:  catalogTotal ? recommendedItems.size / catalogTotal : 0,
    diversity: sumDiv / n
  };
}

module.exports = { evaluateRun };
