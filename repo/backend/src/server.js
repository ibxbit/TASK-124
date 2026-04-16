'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const multipart = require('@fastify/multipart');

const config = require('./config');
const embedded = require('./db/embedded');
const { runAll: runMigrations } = require('./db/migrate');
const { getDb, closeDb } = require('./db/pool');
const authPlugin = require('./auth/authPlugin');
const routes = require('./routes');
const checkpoints = require('./services/checkpointService');
const recovery = require('./services/recoveryService');
const memory = require('./services/memoryService');
const { StartupTimer, TARGET_INTERACTIVE_MS } = require('./services/startupTimer');

// Deferred: bcryptjs is only used at login and first-boot admin seed — both
// off the interactive path. Skipping the top-level require saves ~30–60ms.
let _bcrypt = null;
function getBcrypt() { return _bcrypt || (_bcrypt = require('bcryptjs')); }

async function ensureDefaultAdmin() {
  const db = getDb();
  // One demo user per role so reviewers can exercise every RBAC path after
  // `docker-compose up`. Each row is upserted independently (ON CONFLICT
  // DO NOTHING) so a partially-seeded volume (e.g. only 'admin' present from
  // an older build) still converges to the complete set on next boot.
  const bcrypt = getBcrypt();
  const seeds = [
    ['admin',     'admin',         'admin'],
    ['analyst',   'analyst123',    'analyst'],
    ['moderator', 'moderator123',  'moderator'],
    ['finance',   'finance123',    'finance']
  ];
  let created = 0;
  for (const [username, password, role] of seeds) {
    const hash = await bcrypt.hash(password, 10);
    const r = await db.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`, [username, hash, role]);
    if (r.rows.length) created++;
  }
  if (created > 0) {
    console.log(`[bootstrap] demo users seeded: ${created} of 4 (admin/analyst/moderator/finance)`);
  }
}

function validateConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    throw new Error(
      'FATAL: JWT_SECRET env var is missing or too short (min 16 chars). ' +
      'Set a strong secret: export JWT_SECRET="$(openssl rand -hex 32)"');
  }
}

async function build() {
  validateConfig();
  const app = Fastify({ logger: true, bodyLimit: 60 * 1024 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)
        || (config.lanOnly &&
            /^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(origin));
      cb(ok ? null : new Error('CORS blocked'), ok);
    }
  });
  await app.register(sensible);
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }
  });

  // LAN allowlist enforcement: when LAN_ONLY=true, reject non-allowlisted IPs
  if (config.lanOnly) {
    const lanSvc = require('./services/lanAllowlistService');
    app.addHook('onRequest', async (request, reply) => {
      // Always allow health checks for monitoring
      if (request.url === '/health') return;
      const ok = await lanSvc.isAllowed(request.ip);
      if (!ok) return reply.code(403).send({ error: 'Machine not in LAN allowlist' });
    });
  }

  await app.register(authPlugin);
  await app.register(routes);

  app.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));

  return app;
}

async function start() {
  const timer = new StartupTimer('server');

  // ── Critical path — gates interactivity ──────────────────────────────────
  await embedded.start();
  timer.mark('pg_started');

  await runMigrations();
  timer.mark('migrations');

  const app = await build();
  timer.mark('app_built');

  const host = config.apiHost;
  await app.listen({ port: config.apiPort, host });
  timer.mark('listening');                       // ← interactive

  const s = timer.summary();
  app.log.info(
    { interactiveMs: s.interactiveMs, phases: s.phases },
    `ready in ${s.interactiveMs}ms` +
    (s.withinTarget ? '' : ` (exceeded ${TARGET_INTERACTIVE_MS}ms target)`));

  // ── Post-listen warm-up — runs concurrently, non-blocking ────────────────
  Promise.allSettled([
    ensureDefaultAdmin()
      .then(() => timer.mark('admin_seeded'))
      .catch(err => app.log.error({ err }, 'admin seed failed')),
    recovery.restoreAll()
      .then(() => timer.mark('recovery_done'))
      .catch(err => app.log.error({ err }, 'recovery failed')),
    Promise.resolve().then(() => { checkpoints.start(); timer.mark('checkpoints_on'); }),
    Promise.resolve().then(() => { memory.start();       timer.mark('memory_on'); })
  ]).then(() => {
    timer.mark('warmup_complete');
    timer.persist(getDb()).catch(err => app.log.error({ err }, 'timer persist failed'));
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    checkpoints.stop();
    memory.stop();
    try { await checkpoints.runOnce(); } catch {}
    await app.close();
    await closeDb();
    await embedded.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return { app, timer };
}

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { build, start };
