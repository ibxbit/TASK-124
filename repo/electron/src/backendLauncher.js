'use strict';

const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { getMasterKeyHex } = require('./keystore');

let child = null;

// Generate a per-boot JWT secret shared between Electron and the backend
// process it spawns. This avoids hardcoded secrets and ensures the desktop
// shell can mint a valid service token for background job calls.
const serviceJwtSecret = process.env.JWT_SECRET
  || ('electron-svc-' + crypto.randomBytes(20).toString('hex'));

function backendEntry() {
  return path.resolve(__dirname, '..', '..', 'backend', 'src', 'server.js');
}

function startBackend() {
  if (child) return child;
  const env = {
    ...process.env,
    MERCHANT_DB_KEY: getMasterKeyHex(),
    JWT_SECRET: serviceJwtSecret,
    API_PORT: process.env.API_PORT || '3131',
    API_HOST: process.env.API_HOST || '127.0.0.1'
  };
  child = fork(backendEntry(), [], { env, stdio: 'inherit' });
  child.on('exit', () => { child = null; });
  return child;
}

function stopBackend() {
  if (child) { child.kill(); child = null; }
}

function getServiceJwtSecret() { return serviceJwtSecret; }

module.exports = { startBackend, stopBackend, getServiceJwtSecret };
