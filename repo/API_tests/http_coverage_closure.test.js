'use strict';

// HTTP-coverage closure tests.
//
// Purpose: every test in this file exercises one specific previously-uncovered
// endpoint using `app.inject` (real Fastify routing → real handlers → real DB).
// No service-layer calls, no mocks. URLs are plain string literals with
// deterministic numeric IDs so the coverage auditor can match each
// (method, path) to the route template.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getApp, getToken, authHeader, closeApp, getDb } = require('./helpers');

test.after(closeApp);

// Deterministic ID namespace for this file — chosen high enough to avoid
// collisions with data seeded by other tests, low enough to stay inside int range.
const ID = {
  lanAllow:    990001,
  savedQuery:  990002,
  exportJob:   990003,
  exportDl:    990004,
  blacklist:   990005,
  experiment:  990006,
  recoRun:     990007,
  payment:     990008,
  cycle:       990009,
  refund:      990010,
  refundApp:   990011,
  refundRej:   990012,
  refundExe:   990013,
  refundAud:   990014,
  review:      990015,
  reviewHide:  990016,
  reviewRes:   990017,
  reviewApp:   990018,
  reviewDec:   990019,
  appeal:      990020,
  oliId:       'OLI-HC-990015',
  ordId:       'ORD-HC-990015',
  followee:    'user-hc-followee',
};

// ─── shared setup: seed every row we'll touch by deterministic PK ────────────

async function seedAll(app) {
  const db = getDb();

  // resolve analyst/moderator/finance user ids once — many seeded rows FK to users
  const adminToken    = await getToken(app, 'admin');
  const analystToken  = await getToken(app, 'analyst');
  const modToken      = await getToken(app, 'moderator');
  const financeToken  = await getToken(app, 'finance');

  async function uid(role) {
    const me = await app.inject({
      method: 'GET', url: '/auth/me',
      headers: authHeader(role === 'admin'    ? adminToken
                        : role === 'analyst'  ? analystToken
                        : role === 'moderator'? modToken
                        : financeToken)
    });
    return JSON.parse(me.payload).id;
  }
  const adminId   = await uid('admin');
  const analystId = await uid('analyst');
  const modId     = await uid('moderator');
  const financeId = await uid('finance');

  // lan_allowlist — DELETE /admin/lan-allowlist/:id
  await db.query(
    `INSERT INTO lan_allowlist (id, ip_address, label, active, added_by)
     VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (id) DO UPDATE SET ip_address=EXCLUDED.ip_address, active=true`,
    [ID.lanAllow, '10.99.0.101', 'closure-test', adminId]);
  await db.query(
    `SELECT setval('lan_allowlist_id_seq', GREATEST((SELECT MAX(id) FROM lan_allowlist), $1))`,
    [ID.lanAllow + 1]);

  // saved_queries — DELETE /queries/saved/:id
  await db.query(
    `INSERT INTO saved_queries (id, user_id, name, definition)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition`,
    [ID.savedQuery, analystId, 'closure-test-query-' + ID.savedQuery,
     JSON.stringify({ filters: { dateFrom: '01/01/2020', dateTo: '12/31/2020' } })]);
  await db.query(
    `SELECT setval('saved_queries_id_seq', GREATEST((SELECT MAX(id) FROM saved_queries), $1))`,
    [ID.savedQuery + 1]);

  // export_jobs — GET /exports/:id and GET /exports/:id/download
  // 1) a pending job we can fetch metadata for
  await db.query(
    `INSERT INTO export_jobs (id, user_id, format, definition, status)
     VALUES ($1, $2, 'csv', $3::jsonb, 'pending')
     ON CONFLICT (id) DO UPDATE SET status='pending'`,
    [ID.exportJob, analystId,
     JSON.stringify({ filters: { dateFrom: '01/01/2020', dateTo: '12/31/2020' } })]);

  // 2) a completed job with a real file on disk that download can stream back
  const dlPath = path.join(require('os').tmpdir(), `export-dl-${ID.exportDl}.csv`);
  fs.writeFileSync(dlPath, 'id,amount\n1,100\n2,200\n', 'utf8');
  await db.query(
    `INSERT INTO export_jobs (id, user_id, format, definition, status, row_count, file_path, completed_at)
     VALUES ($1, $2, 'csv', $3::jsonb, 'completed', 2, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET status='completed', file_path=EXCLUDED.file_path`,
    [ID.exportDl, analystId,
     JSON.stringify({ filters: { dateFrom: '01/01/2020', dateTo: '12/31/2020' } }),
     dlPath]);
  await db.query(
    `SELECT setval('export_jobs_id_seq', GREATEST((SELECT MAX(id) FROM export_jobs), $1))`,
    [ID.exportDl + 1]);

  // blacklist — DELETE /admin/blacklists/:id
  await db.query(
    `INSERT INTO blacklists (id, kind, value, added_by)
     VALUES ($1, 'word', 'closurebanned', $2)
     ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value`,
    [ID.blacklist, adminId]);
  await db.query(
    `SELECT setval('blacklists_id_seq', GREATEST((SELECT MAX(id) FROM blacklists), $1))`,
    [ID.blacklist + 1]);

  // experiments — POST /experiments/:id/versions, GET /experiments/:id/assignment
  await db.query(
    `INSERT INTO experiments (id, name, description)
     VALUES ($1, $2, 'closure-test')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
    [ID.experiment, 'exp-closure-' + ID.experiment]);
  await db.query(
    `SELECT setval('experiments_id_seq', GREATEST((SELECT MAX(id) FROM experiments), $1))`,
    [ID.experiment + 1]);
  // active version covering NOW() so the assignment query finds a row
  await db.query(
    `INSERT INTO experiment_versions (experiment_id, version, start_ts, end_ts, traffic_split, created_by)
     VALUES ($1, 1, NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', '{"A":50,"B":50}'::jsonb, $2)
     ON CONFLICT (experiment_id, version) DO UPDATE
       SET start_ts=EXCLUDED.start_ts, end_ts=EXCLUDED.end_ts`,
    [ID.experiment, adminId]);

  // recommendation_runs — POST /recommendations/evaluate
  await db.query(
    `INSERT INTO recommendation_runs (id, name)
     VALUES ($1, 'closure-reco-run')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
    [ID.recoRun]);
  await db.query(
    `SELECT setval('recommendation_runs_id_seq', GREATEST((SELECT MAX(id) FROM recommendation_runs), $1))`,
    [ID.recoRun + 1]);
  await db.query(`INSERT INTO catalog_items (item_id, category)
    VALUES ('hc-a','X'),('hc-b','Y'),('hc-c','X') ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO recommendation_items (run_id, user_id, rank, item_id, category)
     VALUES ($1,'u-hc',1,'hc-a','X'),($1,'u-hc',2,'hc-b','Y')
     ON CONFLICT DO NOTHING`, [ID.recoRun]);
  await db.query(
    `INSERT INTO recommendation_ground_truth (run_id, user_id, item_id)
     VALUES ($1,'u-hc','hc-a') ON CONFLICT DO NOTHING`, [ID.recoRun]);

  // payments — POST /finance/payments/:id/transition
  await db.query(
    `INSERT INTO payments (id, external_id, provider, merchant_id, order_id, state, gross_amount, occurred_at)
     VALUES ($1, $2, 'bank', 'M-HC', 'O-HC', 'pre_auth', 500, NOW())
     ON CONFLICT (id) DO UPDATE SET state='pre_auth'`,
    [ID.payment, 'EXT-HC-' + ID.payment]);
  await db.query(
    `SELECT setval('payments_id_seq', GREATEST((SELECT MAX(id) FROM payments), $1))`,
    [ID.payment + 1]);

  // settlement_cycles + settlement_lines — GET /settlement/cycles/:id/lines
  await db.query(
    `INSERT INTO settlement_cycles (id, period_start, period_end, status, total_gross, total_fees, total_net, run_by)
     VALUES ($1, '2020-01-06', '2020-01-12', 'completed', 100, 10, 90, $2)
     ON CONFLICT (id) DO UPDATE SET status='completed'`,
    [ID.cycle, financeId]);
  await db.query(
    `SELECT setval('settlement_cycles_id_seq', GREATEST((SELECT MAX(id) FROM settlement_cycles), $1))`,
    [ID.cycle + 1]);
  await db.query(
    `INSERT INTO settlement_lines (cycle_id, merchant_id, gross, fees, net)
     VALUES ($1, 'M-HC', 100, 10, 90)
     ON CONFLICT DO NOTHING`, [ID.cycle]);

  // refunds — PATCH /refunds/:id, approve/reject/execute, audit
  // We seed a payment per refund to satisfy the FK and balance math.
  async function seedRefund(refundId, status) {
    const payExt = `EXT-RF-${refundId}`;
    const { rows } = await db.query(
      `INSERT INTO payments (external_id, provider, merchant_id, order_id, state, gross_amount, occurred_at)
       VALUES ($1, 'bank', 'M-RF', $2, 'full', 1000, NOW())
       ON CONFLICT (external_id) DO UPDATE SET provider='bank'
       RETURNING id`,
      [payExt, 'O-RF-' + refundId]);
    const paymentId = rows[0].id;
    await db.query(
      `INSERT INTO refunds (id, payment_id, provider, amount, reason, status, risk_flags, created_by)
       VALUES ($1, $2, 'bank', 100, 'closure', $3, '[]'::jsonb, $4)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status`,
      [refundId, paymentId, status, financeId]);
  }
  await seedRefund(ID.refund,    'pending');
  await seedRefund(ID.refundApp, 'pending_review');
  await seedRefund(ID.refundRej, 'pending_review');
  await seedRefund(ID.refundExe, 'approved');
  await seedRefund(ID.refundAud, 'approved');
  await db.query(
    `SELECT setval('refunds_id_seq', GREATEST((SELECT MAX(id) FROM refunds), $1))`,
    [ID.refundAud + 1]);

  // order_line_item (needed as FK parent for any new reviews) + reviews
  await db.query(
    `INSERT INTO order_line_items (id, order_id, sku, quantity)
     VALUES ($1, $2, 'WIDGET', 1)
     ON CONFLICT (id) DO NOTHING`,
    [ID.oliId, ID.ordId]);

  async function seedReview(reviewId, status, oliSuffix) {
    const oli = `${ID.oliId}-${oliSuffix}`;
    const ord = `${ID.ordId}-${oliSuffix}`;
    await db.query(
      `INSERT INTO order_line_items (id, order_id, sku, quantity)
       VALUES ($1, $2, 'WIDGET', 1) ON CONFLICT (id) DO NOTHING`, [oli, ord]);
    await db.query(
      `INSERT INTO reviews (id, order_line_item_id, order_id, reviewer_id, device_id, rating, tags, body, anonymous, status)
       VALUES ($1, $2, $3, $4, 'dev1', 4, '{}', 'closure-test', false, $5)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status`,
      [reviewId, oli, ord, String(modId), status]);
  }
  await seedReview(ID.review,     'visible', 'r');
  await seedReview(ID.reviewHide, 'visible', 'h');
  await seedReview(ID.reviewRes,  'hidden',  's');
  await seedReview(ID.reviewApp,  'hidden',  'a');
  await seedReview(ID.reviewDec,  'visible', 'd');
  await db.query(
    `SELECT setval('reviews_id_seq', GREATEST((SELECT MAX(id) FROM reviews), $1))`,
    [ID.reviewDec + 1]);

  // review_appeal — POST /appeals/:id/resolve (status must be 'pending')
  await db.query(
    `INSERT INTO review_appeals (id, review_id, reason, status)
     VALUES ($1, $2, 'closure-appeal', 'pending')
     ON CONFLICT (id) DO UPDATE SET status='pending'`,
    [ID.appeal, ID.reviewApp]);
  await db.query(
    `SELECT setval('review_appeals_id_seq', GREATEST((SELECT MAX(id) FROM review_appeals), $1))`,
    [ID.appeal + 1]);

  // follow rows — GET /users/:id/followers + /following
  await db.query(
    `INSERT INTO follows (follower_id, followee_id)
     VALUES ('user-hc-follower', $1), ($1, 'user-hc-target')
     ON CONFLICT DO NOTHING`, [ID.followee]);

  return { adminToken, analystToken, modToken, financeToken,
           adminId, analystId, modId, financeId, dlPath };
}

let CTX = null;
async function ctx() {
  if (CTX) return CTX;
  const app = await getApp();
  CTX = { app, ...(await seedAll(app)) };
  return CTX;
}

// ─── ENDPOINT 1: DELETE /admin/lan-allowlist/:id ─────────────────────────────

test('DELETE /admin/lan-allowlist/:id deactivates entry (admin)', async () => {
  const { app, adminToken } = await ctx();
  const res = await app.inject({
    method: 'DELETE',
    url: '/admin/lan-allowlist/990001',
    headers: authHeader(adminToken)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.id, 990001);
  const { rows } = await getDb().query('SELECT active FROM lan_allowlist WHERE id=$1', [990001]);
  assert.equal(rows[0].active, false);
});

test('DELETE /admin/lan-allowlist/:id forbidden for analyst (403)', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'DELETE',
    url: '/admin/lan-allowlist/990001',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 403);
});

// ─── ENDPOINT 2: DELETE /queries/saved/:id ───────────────────────────────────

test('DELETE /queries/saved/:id removes analyst-owned saved query', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'DELETE',
    url: '/queries/saved/990002',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).ok, true);
  const { rows } = await getDb().query('SELECT id FROM saved_queries WHERE id=$1', [990002]);
  assert.equal(rows.length, 0);
});

test('DELETE /queries/saved/:id unauthenticated returns 401', async () => {
  const { app } = await ctx();
  const res = await app.inject({ method: 'DELETE', url: '/queries/saved/990002' });
  assert.equal(res.statusCode, 401);
});

// ─── ENDPOINT 3: GET /exports/:id ────────────────────────────────────────────

test('GET /exports/:id returns owner export job metadata', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/exports/990003',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 200);
  const job = JSON.parse(res.payload);
  assert.equal(job.id, 990003);
  assert.equal(job.format, 'csv');
});

test('GET /exports/:id returns 404 for unknown id', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/exports/99990099',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 404);
});

// ─── ENDPOINT 4: GET /exports/:id/download ───────────────────────────────────

test('GET /exports/:id/download streams completed CSV file', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/exports/990004/download',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.match(res.payload, /id,amount/);
});

test('GET /exports/:id/download returns 409 when job not completed', async () => {
  const { app, analystToken } = await ctx();
  // 990003 is 'pending' — download should reject
  const res = await app.inject({
    method: 'GET',
    url: '/exports/990003/download',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 409);
});

// ─── ENDPOINT 5: GET /users/:id/followers ────────────────────────────────────

test('GET /users/:id/followers returns follower rows', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/users/user-hc-followee/followers',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  assert.ok(list.some(r => r.follower_id === 'user-hc-follower'));
});

// ─── ENDPOINT 6: GET /users/:id/following ────────────────────────────────────

test('GET /users/:id/following returns followee rows', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/users/user-hc-followee/following',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse(res.payload);
  assert.ok(Array.isArray(list));
  assert.ok(list.some(r => r.followee_id === 'user-hc-target'));
});

test('GET /users/:id/following unauthenticated returns 401', async () => {
  const { app } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/users/user-hc-followee/following'
  });
  assert.equal(res.statusCode, 401);
});

// ─── ENDPOINT 7: DELETE /admin/blacklists/:id ────────────────────────────────

test('DELETE /admin/blacklists/:id removes blacklist entry', async () => {
  const { app, adminToken } = await ctx();
  const res = await app.inject({
    method: 'DELETE',
    url: '/admin/blacklists/990005',
    headers: authHeader(adminToken)
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).id, 990005);
});

test('DELETE /admin/blacklists/:id forbidden for finance (403)', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'DELETE',
    url: '/admin/blacklists/990005',
    headers: authHeader(financeToken)
  });
  assert.equal(res.statusCode, 403);
});

// ─── ENDPOINT 8: POST /experiments/:id/versions ──────────────────────────────

test('POST /experiments/:id/versions creates a new version (admin)', async () => {
  const { app, adminToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/experiments/990006/versions',
    headers: authHeader(adminToken),
    payload: {
      startTs: '2030-01-01T00:00:00Z',
      endTs:   '2030-02-01T00:00:00Z',
      trafficSplit: { A: 50, B: 50 }
    }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.experiment_id, 990006);
  assert.ok(body.version >= 2);
});

test('POST /experiments/:id/versions rejects missing fields (400)', async () => {
  const { app, adminToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/experiments/990006/versions',
    headers: authHeader(adminToken),
    payload: { startTs: '2030-01-01' }
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 9: GET /experiments/:id/assignment ─────────────────────────────

test('GET /experiments/:id/assignment returns bucket for user', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/experiments/990006/assignment?userId=demo-user-42',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.experimentId, 990006);
  assert.equal(body.userId, 'demo-user-42');
  assert.ok(body.bucket);
  assert.ok(Number.isInteger(body.version));
});

test('GET /experiments/:id/assignment without userId returns 400', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/experiments/990006/assignment',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 10: POST /recommendations/evaluate ─────────────────────────────

test('POST /recommendations/evaluate returns metrics for seeded run', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/recommendations/evaluate',
    headers: authHeader(analystToken),
    payload: { runId: 990007 }
  });
  assert.equal(res.statusCode, 200);
  const m = JSON.parse(res.payload);
  assert.equal(m.runId, 990007);
  assert.ok(typeof m.precision === 'number');
  assert.ok(typeof m.recall === 'number');
  assert.ok(typeof m.ndcg10 === 'number');
});

test('POST /recommendations/evaluate without runId returns 400', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/recommendations/evaluate',
    headers: authHeader(analystToken),
    payload: {}
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 11: POST /finance/imports (multipart) ──────────────────────────

function buildMultipart(fields, file) {
  const boundary = '----closureTestBoundary' + Date.now();
  const CRLF = '\r\n';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
      `${value}${CRLF}`);
  }
  if (file) {
    parts.push(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${CRLF}` +
      `Content-Type: ${file.contentType}${CRLF}${CRLF}`);
    parts.push(file.content + CRLF);
  }
  parts.push(`--${boundary}--${CRLF}`);
  return { body: Buffer.from(parts.join(''), 'utf8'),
           contentType: `multipart/form-data; boundary=${boundary}` };
}

test('POST /finance/imports ingests a wechat_pay CSV via multipart', async () => {
  const { app, financeToken } = await ctx();
  const csv =
    'transaction_id,merchant_id,order_id,type,amount,time\n' +
    `TX-HC-${Date.now()},M-HC-IMP,O-HC-IMP,deposit,250,2026-02-02T10:00:00Z\n`;
  const { body, contentType } = buildMultipart(
    { source: 'wechat_pay' },
    { name: 'file', filename: 'wx.csv', contentType: 'text/csv', content: csv });
  const res = await app.inject({
    method: 'POST',
    url: '/finance/imports',
    headers: { ...authHeader(financeToken), 'content-type': contentType },
    payload: body
  });
  assert.equal(res.statusCode, 200);
  const body2 = JSON.parse(res.payload);
  assert.ok(body2.fileId);
  assert.equal(body2.rowsTotal, 1);
  assert.equal(body2.rowsImported, 1);
});

test('POST /finance/imports rejects non-multipart (400)', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/finance/imports',
    headers: authHeader(financeToken),
    payload: { source: 'bank' }
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 12: POST /finance/payments/:id/transition ──────────────────────

test('POST /finance/payments/:id/transition moves pre_auth → deposit', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/finance/payments/990008/transition',
    headers: authHeader(financeToken),
    payload: { toState: 'deposit', reason: 'closure test' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.from, 'pre_auth');
  assert.equal(body.to, 'deposit');
});

test('POST /finance/payments/:id/transition rejects illegal state (409)', async () => {
  const { app, financeToken } = await ctx();
  // payment is now in 'deposit' — can only move to 'full'
  const res = await app.inject({
    method: 'POST',
    url: '/finance/payments/990008/transition',
    headers: authHeader(financeToken),
    payload: { toState: 'pre_auth' }
  });
  assert.equal(res.statusCode, 409);
});

// ─── ENDPOINT 13: GET /settlement/cycles/:id/lines ───────────────────────────

test('GET /settlement/cycles/:id/lines returns per-merchant breakdown', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/settlement/cycles/990009/lines',
    headers: authHeader(financeToken)
  });
  assert.equal(res.statusCode, 200);
  const lines = JSON.parse(res.payload);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.some(l => l.merchant_id === 'M-HC'));
});

// ─── ENDPOINT 14: PATCH /refunds/:id ─────────────────────────────────────────

test('PATCH /refunds/:id updates amount and reason', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'PATCH',
    url: '/refunds/990010',
    headers: authHeader(financeToken),
    payload: { amount: 50, reason: 'edited' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.id, 990010);
  assert.equal(body.amount, 50);
  assert.equal(body.reason, 'edited');
});

test('PATCH /refunds/:id with invalid amount returns 400', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'PATCH',
    url: '/refunds/990010',
    headers: authHeader(financeToken),
    payload: { amount: -5 }
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 15: POST /refunds/:id/approve ──────────────────────────────────

test('POST /refunds/:id/approve approves pending_review refund', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990011/approve',
    headers: authHeader(financeToken),
    payload: { note: 'closure approve' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).status, 'approved');
});

test('POST /refunds/:id/approve rejects already-approved refund (409)', async () => {
  const { app, financeToken } = await ctx();
  // After the prior test the refund is 'approved' — calling approve again should 409
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990011/approve',
    headers: authHeader(financeToken),
    payload: {}
  });
  assert.equal(res.statusCode, 409);
});

// ─── ENDPOINT 16: POST /refunds/:id/reject ───────────────────────────────────

test('POST /refunds/:id/reject rejects a pending_review refund', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990012/reject',
    headers: authHeader(financeToken),
    payload: { note: 'closure reject' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).status, 'rejected');
});

test('POST /refunds/:id/reject on rejected refund returns 409', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990012/reject',
    headers: authHeader(financeToken),
    payload: {}
  });
  assert.equal(res.statusCode, 409);
});

// ─── ENDPOINT 17: POST /refunds/:id/execute ──────────────────────────────────

test('POST /refunds/:id/execute writes ledger entries and marks executed', async () => {
  const { app, financeToken } = await ctx();
  // Ledger entries are append-only (trigger blocks DELETE) — across repeated
  // test runs the same refund may have been executed before. We reset just the
  // refund row to 'approved' so the execute path runs again, then check that
  // the ledger count INCREASED by 2 (one debit + one credit) rather than
  // asserting an absolute count.
  await getDb().query(
    `UPDATE refunds SET status='approved', executed_by=NULL, executed_at=NULL WHERE id=$1`,
    [990013]);
  const before = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE memo = $1`,
    ['refund #990013']);
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990013/execute',
    headers: authHeader(financeToken),
    payload: {}
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).status, 'executed');
  const after = await getDb().query(
    `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE memo = $1`,
    ['refund #990013']);
  assert.equal(after.rows[0].c, before.rows[0].c + 2);
});

test('POST /refunds/:id/execute on non-approved refund returns 409', async () => {
  const { app, financeToken } = await ctx();
  // 990010 is pending (edited above, never approved)
  const res = await app.inject({
    method: 'POST',
    url: '/refunds/990010/execute',
    headers: authHeader(financeToken),
    payload: {}
  });
  assert.equal(res.statusCode, 409);
});

// ─── ENDPOINT 18: GET /refunds/:id/audit ─────────────────────────────────────

test('GET /refunds/:id/audit returns audit trail', async () => {
  const { app, financeToken } = await ctx();
  // first create an audit row so the list is non-empty
  await getDb().query(
    `INSERT INTO refund_audit (refund_id, actor_id, action, details)
     VALUES (990014, 1, 'create', '{"source":"closure"}'::jsonb)`);
  const res = await app.inject({
    method: 'GET',
    url: '/refunds/990014/audit',
    headers: authHeader(financeToken)
  });
  assert.equal(res.statusCode, 200);
  const trail = JSON.parse(res.payload);
  assert.ok(Array.isArray(trail));
  assert.ok(trail.some(e => e.action === 'create'));
});

// ─── ENDPOINT 19: GET /reviews/:id ───────────────────────────────────────────

test('GET /reviews/:id returns the review (authed)', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/reviews/990015',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 200);
  const r = JSON.parse(res.payload);
  assert.equal(r.id, 990015);
  assert.equal(r.rating, 4);
});

test('GET /reviews/:id returns 404 for missing id', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/reviews/99990199',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 404);
});

test('GET /reviews/:id unauthenticated returns 401', async () => {
  const { app } = await ctx();
  const res = await app.inject({ method: 'GET', url: '/reviews/990015' });
  assert.equal(res.statusCode, 401);
});

// ─── ENDPOINT 20: POST /reviews/:id/hide ─────────────────────────────────────

test('POST /reviews/:id/hide moves review to hidden', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/reviews/990016/hide',
    headers: authHeader(modToken),
    payload: { reason: 'closure-hide' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).status, 'hidden');
});

test('POST /reviews/:id/hide forbidden for analyst (403)', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/reviews/990016/hide',
    headers: authHeader(analystToken),
    payload: { reason: 'nope' }
  });
  assert.equal(res.statusCode, 403);
});

// ─── ENDPOINT 21: POST /reviews/:id/restore ──────────────────────────────────

test('POST /reviews/:id/restore moves hidden review back to visible', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/reviews/990017/restore',
    headers: authHeader(modToken),
    payload: { reason: 'closure-restore' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).status, 'visible');
});

// ─── ENDPOINT 22: POST /reviews/:id/appeals ──────────────────────────────────

test('POST /reviews/:id/appeals creates appeal (any authed user)', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/reviews/990018/appeals',
    headers: authHeader(financeToken),
    payload: { reason: 'closure-appeal' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.review_id, 990018);
  assert.equal(body.status, 'pending');
});

test('POST /reviews/:id/appeals without reason returns 400', async () => {
  const { app, financeToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/reviews/990018/appeals',
    headers: authHeader(financeToken),
    payload: {}
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 23: POST /appeals/:id/resolve ──────────────────────────────────

test('POST /appeals/:id/resolve with overturned makes review visible', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/appeals/990020/resolve',
    headers: authHeader(modToken),
    payload: { outcome: 'overturned', reason: 'closure-resolve' }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, 'overturned');
  const { rows } = await getDb().query(
    'SELECT status FROM reviews WHERE id=$1', [990018]);
  assert.equal(rows[0].status, 'visible');
});

test('POST /appeals/:id/resolve with invalid outcome returns 400', async () => {
  const { app, modToken } = await ctx();
  const res = await app.inject({
    method: 'POST',
    url: '/appeals/990020/resolve',
    headers: authHeader(modToken),
    payload: { outcome: 'banana' }
  });
  assert.equal(res.statusCode, 400);
});

// ─── ENDPOINT 24: GET /reviews/:id/decisions ─────────────────────────────────

test('GET /reviews/:id/decisions returns decision log', async () => {
  const { app, modToken } = await ctx();
  // Seed a decision row so the list is non-empty
  await getDb().query(
    `INSERT INTO review_decisions (review_id, moderator_id, decision, reason)
     VALUES (990019, 1, 'hide', 'closure-seed-log')`);
  const res = await app.inject({
    method: 'GET',
    url: '/reviews/990019/decisions',
    headers: authHeader(modToken)
  });
  assert.equal(res.statusCode, 200);
  const log = JSON.parse(res.payload);
  assert.ok(Array.isArray(log));
  assert.ok(log.some(d => d.decision === 'hide'));
});

test('GET /reviews/:id/decisions forbidden for analyst (403)', async () => {
  const { app, analystToken } = await ctx();
  const res = await app.inject({
    method: 'GET',
    url: '/reviews/990019/decisions',
    headers: authHeader(analystToken)
  });
  assert.equal(res.statusCode, 403);
});
