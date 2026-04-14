'use strict';

/**
 * backend-bridge.js
 * Launched from the Electron main process.  Starts the embedded PostgreSQL
 * database, then starts the Fastify server, and returns the port once both
 * are ready.  Keeps a handle so the whole backend can be stopped cleanly.
 */

const path = require('path');

let backendProcess = null; // child process (production)
let inProcessServer = null; // direct module reference (dev / test)

/**
 * Start the backend in-process (avoids IPC overhead, faster startup).
 * Returns the port number the Fastify server bound to.
 *
 * @param {{ userDataPath: string, log: import('electron-log').ElectronLog }} opts
 * @returns {Promise<number>}
 */
async function startBackend({ userDataPath, log }) {
  // Dynamically require to avoid loading all backend deps at module parse time
  const buildServer = require('../../backend/server');

  const server = await buildServer({
    pgDataDir: path.join(userDataPath, 'pgdata'),
    pgPort: 5499,
    apiPort: 3131,
    migrationsDir: path.join(__dirname, '../../backend/db/migrations'),
    log,
  });

  inProcessServer = server;
  return server.address().port;
}

async function stopBackend() {
  if (inProcessServer) {
    await inProcessServer.close();
    inProcessServer = null;
  }
}

module.exports = { startBackend, stopBackend };
