'use strict';

const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getDb() {
  if (!pool) {
    pool = new Pool({
      host:     config.pg.host,
      port:     config.pg.port,
      user:     config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      max: 10,
      idleTimeoutMillis: 10_000
    });
    pool.on('error', (err) => {
      // Never let an idle-client error crash the process
      console.error('[pg] idle client error:', err.message);
    });
  }
  return pool;
}

async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getDb, closeDb };
