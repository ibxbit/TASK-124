'use strict';

// Deterministic, stable-hash bucketing.
const crypto = require('crypto');

function stableHash(userId, experimentId, version) {
  const h = crypto.createHash('sha256');
  h.update(`${experimentId}:${version}:${userId}`);
  const slice = h.digest('hex').slice(0, 8);
  return parseInt(slice, 16) / 0xffffffff;
}

function assignBucket(userId, experimentId, version, trafficSplit) {
  const buckets = Object.keys(trafficSplit);
  const total = buckets.reduce((s, k) => s + Number(trafficSplit[k]), 0);
  if (total <= 0) throw new Error('traffic_split must sum to > 0');
  const r = stableHash(userId, experimentId, version) * total;
  let acc = 0;
  for (const b of buckets) {
    acc += Number(trafficSplit[b]);
    if (r < acc) return b;
  }
  return buckets[buckets.length - 1];
}

module.exports = { stableHash, assignBucket };
