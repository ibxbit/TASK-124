'use strict';

// When running under Docker (PGHOST is set to an external service), embedded
// Postgres is NOT used — the module becomes a no-op. When running as an
// Electron desktop app (no PGHOST), it launches a local instance.

const fs = require('fs');
const config = require('../config');

let instance = null;

function isExternalPg() {
  return !!process.env.PGHOST;
}

async function start() {
  if (isExternalPg()) {
    console.log('[pg] using external Postgres at', config.pg.host + ':' + config.pg.port);
    return null;
  }
  if (instance) return instance;

  const EmbeddedPostgres = require('embedded-postgres');

  if (!fs.existsSync(config.pg.dataDir)) {
    fs.mkdirSync(config.pg.dataDir, { recursive: true });
  }

  instance = new EmbeddedPostgres({
    databaseDir: config.pg.dataDir,
    user: config.pg.user,
    password: config.pg.password,
    port: config.pg.port,
    persistent: true
  });

  try { await instance.initialise(); } catch (err) {
    if (!/already/i.test(String(err.message))) throw err;
  }
  await instance.start();

  try { await instance.createDatabase(config.pg.database); }
  catch (err) { if (!/already exists/i.test(String(err.message))) throw err; }

  return instance;
}

async function stop() {
  if (instance) { await instance.stop(); instance = null; }
}

module.exports = { start, stop };
