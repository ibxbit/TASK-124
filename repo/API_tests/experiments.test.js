'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getToken, authHeader, closeApp } = require('./helpers');

test.after(closeApp);

test('POST /experiments creates an experiment (admin)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments',
    headers: authHeader(token),
    payload: { name: `exp_${Date.now()}`, description: 'API test' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.id);
  assert.ok(body.name.startsWith('exp_'));
});

test('POST /experiments/:id/versions creates a version', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const expRes = await app.inject({
    method: 'POST', url: '/experiments',
    headers: authHeader(token),
    payload: { name: `ver_${Date.now()}` }
  });
  const expId = JSON.parse(expRes.payload).id;
  const res = await app.inject({
    method: 'POST', url: `/experiments/${expId}/versions`,
    headers: authHeader(token),
    payload: {
      startTs: '2025-01-01T00:00:00Z',
      endTs:   '2030-12-31T23:59:59Z',
      trafficSplit: { A: 50, B: 50 }
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).version, 1);
});

test('GET /experiments/:id/assignment returns deterministic bucket', async () => {
  const app = await getApp();
  const adminToken = await getToken(app, 'admin');
  const expRes = await app.inject({
    method: 'POST', url: '/experiments',
    headers: authHeader(adminToken),
    payload: { name: `assign_${Date.now()}` }
  });
  const expId = JSON.parse(expRes.payload).id;
  await app.inject({
    method: 'POST', url: `/experiments/${expId}/versions`,
    headers: authHeader(adminToken),
    payload: {
      startTs: '2025-01-01T00:00:00Z', endTs: '2030-12-31T23:59:59Z',
      trafficSplit: { control: 50, variant: 50 }
    }
  });

  const analystToken = await getToken(app, 'analyst');
  const res1 = await app.inject({
    method: 'GET', url: `/experiments/${expId}/assignment?userId=u42`,
    headers: authHeader(analystToken)
  });
  const res2 = await app.inject({
    method: 'GET', url: `/experiments/${expId}/assignment?userId=u42`,
    headers: authHeader(analystToken)
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  assert.equal(JSON.parse(res1.payload).bucket, JSON.parse(res2.payload).bucket);
});

test('GET /experiments returns array', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'GET', url: '/experiments',
    headers: authHeader(token)
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(res.payload)));
});

// ─── Event log ingestion ────────────────────────────────────────────────────

test('POST /experiments/events/ingest inserts events (admin)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  // Need an experiment first
  const expRes = await app.inject({
    method: 'POST', url: '/experiments',
    headers: authHeader(token),
    payload: { name: `ingest_${Date.now()}` }
  });
  const expId = JSON.parse(expRes.payload).id;
  await app.inject({
    method: 'POST', url: `/experiments/${expId}/versions`,
    headers: authHeader(token),
    payload: { startTs: '2025-01-01', endTs: '2030-12-31', trafficSplit: { A: 50, B: 50 } }
  });
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: expId, version: 1, user_id: 'u1', bucket: 'A',
          event_type: 'impression', occurred_at: '2026-03-01T12:00:00Z' },
        { experiment_id: expId, version: 1, user_id: 'u1', bucket: 'A',
          event_type: 'click', item_id: 'item1', occurred_at: '2026-03-01T12:01:00Z' }
      ]
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).inserted, 2);
});

test('POST /experiments/events/ingest rejects malformed events (400)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: {
      events: [
        { experiment_id: 1 }, // missing all required fields
        { experiment_id: 1, version: 'bad', user_id: 'u1', bucket: 'A',
          event_type: 'invalid_type', occurred_at: 'not-a-date' }
      ]
    }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.payload).details.length > 0);
});

test('POST /experiments/events/ingest rejects empty array (400)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'admin');
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    headers: authHeader(token),
    payload: { events: [] }
  });
  assert.equal(res.statusCode, 400);
});

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

test('unauthenticated event ingest returns 401', async () => {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST', url: '/experiments/events/ingest',
    payload: { events: [] }
  });
  assert.equal(res.statusCode, 401);
});

// ─── Recommendation run ingestion ───────────────────────────────────────────

test('POST /recommendations/runs/ingest creates a run with items + ground truth', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/recommendations/runs/ingest',
    headers: authHeader(token),
    payload: {
      name: `run_${Date.now()}`,
      items: [
        { user_id: 'u1', rank: 1, item_id: 'i1', category: 'cat1' },
        { user_id: 'u1', rank: 2, item_id: 'i2' }
      ],
      ground_truth: [
        { user_id: 'u1', item_id: 'i1' },
        { user_id: 'u1', item_id: 'i3' }
      ]
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(body.runId);
  assert.equal(body.itemsInserted, 2);
  assert.equal(body.groundTruthInserted, 2);
});

test('POST /recommendations/runs/ingest rejects malformed items (400)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'analyst');
  const res = await app.inject({
    method: 'POST', url: '/recommendations/runs/ingest',
    headers: authHeader(token),
    payload: {
      name: 'bad_run',
      items: [{ user_id: 'u1' }] // missing rank + item_id
    }
  });
  assert.equal(res.statusCode, 400);
});

test('moderator cannot ingest recommendation runs (403)', async () => {
  const app = await getApp();
  const token = await getToken(app, 'moderator');
  const res = await app.inject({
    method: 'POST', url: '/recommendations/runs/ingest',
    headers: authHeader(token),
    payload: { name: 'test', items: [{ user_id: 'u1', rank: 1, item_id: 'i1' }] }
  });
  assert.equal(res.statusCode, 403);
});
