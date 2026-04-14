'use strict';

// OS-protected master key. On Windows, Electron's safeStorage wraps DPAPI.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function keyFilePath() {
  return path.join(app.getPath('userData'), 'keystore', 'master.key.enc');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function loadOrCreateMasterKey() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keystore (safeStorage) unavailable');
  }
  const file = keyFilePath();
  if (fs.existsSync(file)) {
    const enc = fs.readFileSync(file);
    const keyHex = safeStorage.decryptString(enc);
    return Buffer.from(keyHex, 'hex');
  }
  const key = crypto.randomBytes(32);
  ensureDir(file);
  fs.writeFileSync(file, safeStorage.encryptString(key.toString('hex')), { mode: 0o600 });
  return key;
}

function getMasterKeyHex() {
  return loadOrCreateMasterKey().toString('hex');
}

module.exports = { getMasterKeyHex };
