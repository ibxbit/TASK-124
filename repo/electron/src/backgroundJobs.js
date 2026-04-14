'use strict';

// Tray-mode background jobs — real work while the app is minimized to tray.
// Each call is authenticated (uses the boot-time service token), idempotent,
// and safe to fire repeatedly (the backend gate-checks state before acting).
const http = require('http');

const PORT = Number(process.env.API_PORT) || 3131;
let serviceToken = null;

function setServiceToken(token) { serviceToken = token; }

function call(path, method = 'POST') {
  return new Promise((resolve) => {
    const headers = { 'Content-Type': 'application/json' };
    if (serviceToken) headers['Authorization'] = `Bearer ${serviceToken}`;
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method, headers },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', () => resolve());
    req.end();
  });
}

const timers = [];

function startBackgroundJobs() {
  // 1. Checkpoint trigger every 5 min → forces a DB snapshot of in-flight state
  timers.push(setInterval(() => {
    call('/admin/checkpoints/run-now', 'POST');
  }, 5 * 60 * 1000));

  // 2. Settlement attempt every 15 min → backend enforces Sunday-23:59 cutoff,
  //    so this is a safe no-op outside the settlement window
  timers.push(setInterval(() => {
    call('/settlement/run', 'POST');
  }, 15 * 60 * 1000));

  // 3. Housekeeping once per hour → prunes old checkpoints + memory samples
  timers.push(setInterval(() => {
    call('/admin/memory/housekeeping', 'POST');
  }, 60 * 60 * 1000));
}

function stopBackgroundJobs() {
  while (timers.length) clearInterval(timers.pop());
}

module.exports = { startBackgroundJobs, stopBackgroundJobs, setServiceToken };
