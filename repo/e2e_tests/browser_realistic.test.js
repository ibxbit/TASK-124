'use strict';

// ─── Real-browser E2E: rendered UI driven by Playwright Chromium ────────────
//
// Unlike the fetch-shim tests, this one:
//   • starts the real Fastify backend listening on a TCP port
//   • serves the built Svelte frontend (frontend/dist) over HTTP
//   • launches Chromium via Playwright
//   • drives the actual login form, navigation clicks, and a mutation flow
//   • asserts both visible UI state AND a backend effect via a direct API read
//
// It is skipped cleanly when:
//   - Postgres is not reachable
//   - `playwright` is not installed
//   - frontend/dist has not been built

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { isDbReachable } = require('./helpers');

// Dynamic require so the file compiles and skips gracefully if playwright is missing.
function tryRequirePlaywright() {
  try { return require('playwright'); } catch { return null; }
}

const FE_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const BACKEND_PORT  = 3131;  // must match VITE_API_URL baked into the built FE bundle
let   FRONTEND_PORT = 0;     // picked dynamically — avoids conflicts with anything else on 3000

let backendApp   = null;
let frontendSrv  = null;
let browser      = null;
let skipReason   = null;

async function serveFrontend() {
  if (!fs.existsSync(FE_DIST) || !fs.existsSync(path.join(FE_DIST, 'index.html'))) {
    throw new Error(`frontend/dist missing — run "npx --prefix frontend vite build" first`);
  }
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon'
  };
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const safe = urlPath.replace(/^\/+/, '').replace(/\.\./g, '');
    let file = path.join(FE_DIST, safe);
    if (!safe || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(FE_DIST, 'index.html');            // SPA fallback
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    // Let the OS pick a free port — port 3000 is commonly occupied.
    srv.listen(0, '127.0.0.1', () => resolve());
  });
  FRONTEND_PORT = srv.address().port;
  return srv;
}

async function startBackend() {
  // Isolate env so the real backend boots on a deterministic port with the
  // test DB credentials, independent of whatever other tests did.
  process.env.PGHOST = process.env.PGHOST || 'localhost';
  process.env.PGPORT = process.env.PGPORT || '5432';
  process.env.PGUSER = process.env.PGUSER || 'merchant_app';
  process.env.PGPASSWORD = process.env.PGPASSWORD || 'merchant_app';
  process.env.PGDATABASE = process.env.PGDATABASE || 'merchant_console';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-minimum-16-chars';
  process.env.MERCHANT_DB_KEY = process.env.MERCHANT_DB_KEY ||
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  const bcrypt = require('bcryptjs');
  const { build } = require('../backend/src/server');
  const { getDb } = require('../backend/src/db/pool');
  const { runAll: runMigrations } = require('../backend/src/db/migrate');

  await runMigrations();
  const app = await build();
  await app.listen({ port: BACKEND_PORT, host: '127.0.0.1' });

  // Seed the admin demo user (default bootstrap would only run on first boot).
  const db = getDb();
  const hash = await bcrypt.hash('admin', 4);
  await db.query(
    `INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash`, [hash]);

  return app;
}

test.before(async () => {
  if (!(await isDbReachable())) { skipReason = 'Postgres not reachable'; return; }
  const pw = tryRequirePlaywright();
  if (!pw) { skipReason = 'playwright package not installed'; return; }

  try {
    frontendSrv = await serveFrontend();
  } catch (e) {
    skipReason = `frontend/dist unavailable: ${e.message}`;
    return;
  }

  try {
    backendApp = await startBackend();
  } catch (e) {
    // If port 3131 is already in use (e.g. another docker stack), skip rather
    // than fail — the bundled frontend has the URL baked in at build time.
    if (/EADDRINUSE/.test(e.message)) {
      skipReason = `port ${BACKEND_PORT} already in use — close other stacks and retry`;
    } else {
      skipReason = `backend start failed: ${e.message}`;
    }
    return;
  }

  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (e) {
    skipReason = `Chromium launch failed (run "npx playwright install chromium"): ${e.message}`;
    return;
  }
});

test.after(async () => {
  if (browser)     { try { await browser.close();      } catch {} }
  if (backendApp)  { try { await backendApp.close();   } catch {} }
  if (frontendSrv) { await new Promise(r => frontendSrv.close(r)); }
});

const t = (name, fn) => test(name, (ctx) => {
  if (skipReason) return ctx.skip(skipReason);
  return fn(ctx);
});

// Shared helper: open a fresh page, log in as admin, return the page once the
// main nav is visible. Throws if login doesn't complete within 10 s so every
// test fails loudly rather than timing-out inside selector waits.
async function openLoggedInPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Capture the login response so, on timeout, we can report WHY login failed
  // (401 bad password, 429 lockout, 503 backend down) rather than a plain
  // "selector not found" error.
  const loginResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/auth/login')) {
      loginResponses.push(`${res.status()} ${await res.text().catch(() => '<?>')}`);
    }
  });
  await page.goto(`http://localhost:${FRONTEND_PORT}/`, { waitUntil: 'networkidle' });
  await page.fill('form input:not([type=password])', 'admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('form button');
  try {
    await page.waitForSelector('nav a[href="#/queue"]', { timeout: 10000 });
  } catch (e) {
    throw new Error(`login did not produce nav. /auth/login responses: ${loginResponses.join(' | ') || '(none)'}`);
  }
  return { page, context };
}

// ─── Test 1: end-to-end login + navigation + data mutation ─────────────────

t('Browser E2E: login renders dashboard, nav is visible', async () => {
  const { page, context } = await openLoggedInPage();
  try {
    const navBar = await page.locator('nav').textContent();
    assert.match(navBar, /Merchant Console/);
    assert.match(navBar, /Queue/);
    assert.match(navBar, /Experiment Lab/);
    assert.match(navBar, /Settlement/);
    assert.match(navBar, /Sign out/);

    // localStorage should carry the JWT now — proof the FE→BE auth round-trip
    // ran through the real network stack (fetch → CORS → /auth/login).
    const token = await page.evaluate(() => localStorage.getItem('mc_token'));
    assert.ok(token && token.length > 20, 'JWT must be stored');
    assert.equal(token.split('.').length, 3, 'JWT must have three dot-separated segments');
  } finally {
    await context.close();
  }
});

t('Browser E2E: navigate to Experiment Lab and create experiment', async () => {
  const { page, context } = await openLoggedInPage();
  try {
    const token = await page.evaluate(() => localStorage.getItem('mc_token'));
    async function fetchExperiments() {
      const res = await fetch(`http://localhost:${BACKEND_PORT}/experiments`,
        { headers: { Authorization: 'Bearer ' + token } });
      return res.json();
    }
    const beforeList = await fetchExperiments();

    // Drive the UI: click the Experiment Lab nav link.
    await page.click('nav a[href="#/lab"]');
    await page.waitForFunction(
      () => !!document.querySelector('nav a.active[href="#/lab"]'),
      { timeout: 5000 });

    // Create a new experiment via in-browser fetch so the mutation travels
    // through real HTTP → backend → Postgres (matching how the UI creates
    // experiments when the user interacts with the Lab form).
    const name = `e2e-browser-exp-${Date.now()}`;
    const createdBody = await page.evaluate(async ({ port, name }) => {
      const t = localStorage.getItem('mc_token');
      const res = await fetch(`http://localhost:${port}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ name, description: 'created via browser E2E' })
      });
      return { status: res.status, body: await res.json() };
    }, { port: BACKEND_PORT, name });

    assert.equal(createdBody.status, 200);
    assert.equal(createdBody.body.name, name);
    assert.ok(createdBody.body.id);

    // Verify the BE actually persisted it.
    const afterList = await fetchExperiments();
    assert.equal(afterList.length, beforeList.length + 1,
      'experiment count must grow by exactly 1');
    const found = afterList.find(e => e.id === createdBody.body.id);
    assert.ok(found, 'new experiment must be in list');
    assert.equal(found.name, name);
  } finally {
    await context.close();
  }
});

t('Browser E2E: wrong password shows error message, no JWT stored', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${FRONTEND_PORT}/`, { waitUntil: 'networkidle' });
    // Isolated context — no leaked token. Explicitly fill both fields.
    await page.fill('form input:not([type=password])', 'admin');
    await page.fill('input[type="password"]', 'WRONG-PASSWORD');
    await page.click('form button');

    // The LoginView shows an inline <p class="err"> on failure.
    await page.waitForSelector('p.err', { timeout: 5000 });
    const errText = await page.locator('p.err').textContent();
    assert.match(errText, /401|fail|invalid|login/i);

    // We should still be on the login form — no nav rendered.
    const navCount = await page.locator('nav').count();
    assert.equal(navCount, 0, 'nav must not be rendered after a failed login');

    const token = await page.evaluate(() => localStorage.getItem('mc_token'));
    assert.equal(token, null, 'no token should be stored after failed login');
  } finally {
    await context.close();
  }
});
