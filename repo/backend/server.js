'use strict';

/**
 * backend/server.js
 * Fastify application factory.  Bootstraps embedded PG, runs migrations,
 * registers all route plugins, and returns the listening server instance.
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const path = require('path');

const startEmbeddedPg = require('./db/embedded-postgres');
const createPool = require('./db/connection');
const runMigrations = require('./db/migrations/runner');
const merchantRoutes = require('./routes/merchants');
const experimentRoutes = require('./routes/experiments');
const settlementRoutes = require('./routes/settlements');

/**
 * @param {{
 *   pgDataDir: string,
 *   pgPort: number,
 *   apiPort: number,
 *   migrationsDir: string,
 *   log?: any,
 * }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildServer(opts) {
  const { pgDataDir, pgPort, apiPort, migrationsDir, log } = opts;

  // ── 1. Embedded PostgreSQL ─────────────────────────────────────────────────
  const pgInstance = await startEmbeddedPg({ pgDataDir, pgPort, log });

  // ── 2. Connection pool ─────────────────────────────────────────────────────
  const pool = createPool({ pgPort });

  // ── 3. Migrations ──────────────────────────────────────────────────────────
  await runMigrations({ pool, migrationsDir, log });

  // ── 4. Fastify setup ───────────────────────────────────────────────────────
  const app = Fastify({
    logger: false, // We use electron-log instead
    disableRequestLogging: true,
    trustProxy: false,          // LAN-only, no external proxy
    maxParamLength: 256,
  });

  // Graceful shutdown: stop PG when Fastify closes
  app.addHook('onClose', async () => {
    await pool.end();
    if (pgInstance) await pgInstance.stop();
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    // Only allow requests from this machine (Electron renderer or LAN peers)
    origin: (origin, cb) => {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS blocked'), false);
      }
    },
  });
  await app.register(sensible);

  // ── Decorators ─────────────────────────────────────────────────────────────
  app.decorate('pg', pool);

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  }));

  // ── API routes ─────────────────────────────────────────────────────────────
  app.register(merchantRoutes, { prefix: '/api/merchants' });
  app.register(experimentRoutes, { prefix: '/api/experiments' });
  app.register(settlementRoutes, { prefix: '/api/settlements' });

  // ── Start listening (loopback + LAN) ───────────────────────────────────────
  await app.listen({ port: apiPort, host: '0.0.0.0' });

  if (log) log.info(`Fastify listening on port ${apiPort}`);
  return app;
}

module.exports = buildServer;
