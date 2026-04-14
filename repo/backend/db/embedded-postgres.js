'use strict';

/**
 * backend/db/embedded-postgres.js
 *
 * Bootstraps an embedded PostgreSQL 16 instance using the `embedded-postgres`
 * npm package, which bundles the real PG binaries per-platform.
 *
 * Data directory:  %APPDATA%\mesac\pgdata   (via app.getPath('userData'))
 * Port:            5499   (avoids conflict with any system PG)
 * Credentials:     mesac / mesac_local  (loopback only, never network-exposed)
 */

const EmbeddedPostgres = require('embedded-postgres');
const path = require('path');

const PG_USER = 'mesac';
const PG_PASSWORD = 'mesac_local';
const PG_DB = 'mesac';

/**
 * @param {{ pgDataDir: string, pgPort: number, log?: any }} opts
 * @returns {Promise<import('embedded-postgres')>}
 */
async function startEmbeddedPg({ pgDataDir, pgPort, log }) {
  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: pgPort,
    persistent: true,
    // Write PG logs next to the data dir
    logFilePath: path.join(pgDataDir, '..', 'postgres.log'),
  });

  if (log) log.info(`Embedded PG: initialising at ${pgDataDir} on port ${pgPort}`);

  // init() is idempotent — safe to call on every startup
  await pg.initialise();
  await pg.start();

  // Create the application database if it doesn't exist yet
  await pg.createDatabase(PG_DB);

  if (log) log.info('Embedded PG: ready');
  return pg;
}

module.exports = startEmbeddedPg;
module.exports.PG_USER = PG_USER;
module.exports.PG_PASSWORD = PG_PASSWORD;
module.exports.PG_DB = PG_DB;
