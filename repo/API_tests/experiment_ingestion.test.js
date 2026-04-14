'use strict';

// Audit finding: Experiment event log ingestion and warning thresholds
//
// Tests event log ingestion validation, warning thresholds on metrics,
// per-bucket impression count warnings, and RBAC enforcement.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

// ── Helper to create an experiment with a version ──────────────────────────

async function createExperimentWithVersion(app, token) {
  const expRes = await app.inject({
    method: 'POST', url: '/experiments',
    headers: authHeader(token),
    payload: { name: `ing_${Date.now()}_${Math.random().toString(36).slice(2)}` }
  });
  const expId = JSON.parse(expRes.payload).id;
  await app.inject({
    method: 'POST', url: `/experiments/${expId}/versions`,
    headers: authHeader(token),
    payload: {
      startTs: '2025-01-01T00:00:00Z',
      endTs: '2030-12-31T23:59:59Z',
      trafficSplit: { control: 50, variant: 50 }
    }
  });
  return expId;
}

// ── Event ingestion validation ─────────────────────────────────────────────

test('ingesting events with all valid fields succeeds', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const expId = await createExperimentWithVersion(app, token);

  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: expId, version: 1, user_id: 'u1', bucket: 'control',
          event_type: 'impression', occurred_at: '2026-06-01T10:00:00Z' },
        { experiment_id: expId, version: 1, user_id: 'u1', bucket: 'control',
          event_type: 'click', item_id: 'item1', occurred_at: '2026-06-01T10:01:00Z' },
        { experiment_id: expId, version: 1, user_id: 'u2', bucket: 'variant',
          event_type: 'conversion', occurred_at: '2026-06-01T11:00:00Z' }
      ]
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).inserted, 3);
});

test('ingesting events with invalid event_type returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');

  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: 1, version: 1, user_id: 'u1', bucket: 'A',
          event_type: 'bogus_type', occurred_at: '2026-01-01' }
      ]
    }
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.payload);
  assert.ok(body.details.length > 0);
  assert.ok(body.details[0].includes('event_type'));
});

test('ingesting events with invalid date returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: 1, version: 1, user_id: 'u1', bucket: 'A',
          event_type: 'click', occurred_at: 'not-a-date' }
      ]
    }
  });
  assert.equal(res.statusCode, 400);
});

test('ingesting events with missing required fields returns 400 with details', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: 1 } // missing version, user_id, bucket, event_type, occurred_at
      ]
    }
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.payload);
  assert.ok(body.details.length >= 4, 'Should report multiple missing fields');
});

test('ingesting null/non-array events returns 400', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events: null }
  });
  assert.equal(res.statusCode, 400);
});

// ── Warning thresholds on metrics ──────────────────────────────────────────

test('metrics with low impressions emit insufficient sample warning', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const expId = await createExperimentWithVersion(app, token);

  // Ingest just a few events (well below MIN_IMPRESSIONS=1000)
  const events = [];
  for (let i = 0; i < 5; i++) {
    events.push({
      experiment_id: expId, version: 1,
      user_id: `warn_u${i}`, bucket: 'control',
      event_type: 'impression',
      occurred_at: `2026-06-01T${String(10 + i).padStart(2, '0')}:00:00Z`
    });
    events.push({
      experiment_id: expId, version: 1,
      user_id: `warn_u${i}`, bucket: 'variant',
      event_type: 'impression',
      occurred_at: `2026-06-01T${String(10 + i).padStart(2, '0')}:01:00Z`
    });
  }
  await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events }
  });

  // Fetch metrics
  const metricsRes = await app.inject({
    method: 'GET', url: `/experiments/${expId}/metrics?version=1`,
    headers: authHeader(token)
  });
  assert.equal(metricsRes.statusCode, 200);
  const metrics = JSON.parse(metricsRes.payload);

  // Should have warnings about insufficient sample size
  assert.ok(metrics.warnings.length > 0, 'Should emit warnings for low impression count');
  assert.ok(
    metrics.warnings.some(w => w.includes('insufficient sample')),
    'Warning should mention insufficient sample'
  );
});

test('metrics alpha parameter is respected', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const expId = await createExperimentWithVersion(app, token);

  // Ingest a few events
  await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: expId, version: 1, user_id: 'a1', bucket: 'control',
          event_type: 'impression', occurred_at: '2026-07-01T10:00:00Z' }
      ]
    }
  });

  const res = await app.inject({
    method: 'GET', url: `/experiments/${expId}/metrics?version=1&alpha=0.01`,
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).alpha, 0.01);
});

test('metrics returns bucket-level statistics', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const expId = await createExperimentWithVersion(app, token);

  // Ingest events across both buckets
  const events = [];
  for (let i = 0; i < 3; i++) {
    events.push({
      experiment_id: expId, version: 1,
      user_id: `buck_u${i}`, bucket: 'control',
      event_type: 'impression',
      occurred_at: `2026-08-01T${String(10 + i).padStart(2, '0')}:00:00Z`
    });
    events.push({
      experiment_id: expId, version: 1,
      user_id: `buck_u${i}`, bucket: 'variant',
      event_type: 'impression',
      occurred_at: `2026-08-01T${String(10 + i).padStart(2, '0')}:01:00Z`
    });
  }
  // Add some clicks to variant
  events.push({
    experiment_id: expId, version: 1,
    user_id: 'buck_u0', bucket: 'variant',
    event_type: 'click', item_id: 'x1',
    occurred_at: '2026-08-01T10:02:00Z'
  });

  await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events }
  });

  const metricsRes = await app.inject({
    method: 'GET', url: `/experiments/${expId}/metrics?version=1`,
    headers: authHeader(token)
  });
  assert.equal(metricsRes.statusCode, 200);
  const m = JSON.parse(metricsRes.payload);

  assert.ok(m.buckets.control, 'Should have control bucket stats');
  assert.ok(m.buckets.variant, 'Should have variant bucket stats');
  assert.ok(m.buckets.control.impressions >= 3);
  assert.ok(m.buckets.variant.clicks >= 1);
  assert.ok('ctr' in m.buckets.variant, 'Should compute CTR');
  assert.ok('conversionRate' in m.buckets.variant, 'Should compute conversion rate');
});

// ── RBAC enforcement ───────────────────────────────────────────────────────

test('analyst cannot ingest events (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events: [{ experiment_id: 1, version: 1, user_id: 'u1',
                          bucket: 'A', event_type: 'click', occurred_at: '2026-01-01' }] }
  });
  assert.equal(res.statusCode, 403);
});

test('moderator cannot ingest events (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events: [{ experiment_id: 1, version: 1, user_id: 'u1',
                          bucket: 'A', event_type: 'click', occurred_at: '2026-01-01' }] }
  });
  assert.equal(res.statusCode, 403);
});

test('finance cannot ingest events (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'finance');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events: [{ experiment_id: 1, version: 1, user_id: 'u1',
                          bucket: 'A', event_type: 'click', occurred_at: '2026-01-01' }] }
  });
  assert.equal(res.statusCode, 403);
});

test('metrics require version parameter (400)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'GET', url: '/experiments/1/metrics',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 400);
});
