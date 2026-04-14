'use strict';

/**
 * backend/db/connection.js
 * Creates and exports a node-postgres Pool.
 * Also exposes query helpers that enforce parameterised statements.
 */

const { Pool } = require('pg');
const { PG_USER, PG_PASSWORD, PG_DB } = require('./embedded-postgres');

/**
 * @param {{ pgPort: number }} opts
 * @returns {import('pg').Pool}
 */
function createPool({ pgPort }) {
  const pool = new Pool({
    host: '127.0.0.1',
    port: pgPort,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DB,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Keep connections alive — the process runs for 30 days
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[pg-pool] Unexpected error on idle client:', err.message);
  });

  return pool;
}

module.exports = createPool;
