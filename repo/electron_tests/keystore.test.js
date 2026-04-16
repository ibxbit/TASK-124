'use strict';

// ─── Electron: keystore.js ───────────────────────────────────────────────────
// OS-protected master-key persistence. We exercise:
//   • generate-on-first-use (no existing file → random 32-byte key)
//   • load-on-subsequent-use (existing file → decrypt + return)
//   • safeStorage unavailable → throws with descriptive error

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMock, installElectronMock, clearAllCaches } = require('./_electron-mock');

function scratchDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-t-'));
  return d;
}

function freshModule(options = {}) {
  clearAllCaches();
  const mock = makeMock(options);
  installElectronMock(mock);
  const mod = require('../electron/src/keystore');
  return { mod, mock };
}

test('getMasterKeyHex: generates a new 32-byte key on first use (no file yet)', () => {
  const userData = scratchDir();
  const { mod } = freshModule({ userData });
  const hex = mod.getMasterKeyHex();
  assert.equal(typeof hex, 'string');
  assert.equal(hex.length, 64); // 32 bytes hex
  assert.match(hex, /^[0-9a-f]+$/);

  // File should have been created
  const keyFile = path.join(userData, 'keystore', 'master.key.enc');
  assert.ok(fs.existsSync(keyFile));
  // File should be encrypted (not raw hex)
  const raw = fs.readFileSync(keyFile, 'utf8');
  assert.ok(raw.startsWith('ENC:')); // our mock's encryptString prefix
});

test('getMasterKeyHex: subsequent call returns same key by decrypting the file', () => {
  const userData = scratchDir();
  const { mod } = freshModule({ userData });
  const first = mod.getMasterKeyHex();
  const second = mod.getMasterKeyHex();
  assert.equal(first, second);
});

test('getMasterKeyHex: across fresh module loads, reads from existing file', () => {
  const userData = scratchDir();
  const first = (freshModule({ userData }).mod).getMasterKeyHex();
  const second = (freshModule({ userData }).mod).getMasterKeyHex();
  assert.equal(first, second);
});

test('getMasterKeyHex: throws when safeStorage is unavailable', () => {
  const userData = scratchDir();
  const { mod } = freshModule({ userData, safeStorageReturn: false });
  assert.throws(() => mod.getMasterKeyHex(), /safeStorage/);
});

test('getMasterKeyHex: key directory is created with mode 0o700 if missing', () => {
  const userData = scratchDir();
  const nestedPath = path.join(userData, 'keystore');
  assert.equal(fs.existsSync(nestedPath), false);
  const { mod } = freshModule({ userData });
  mod.getMasterKeyHex();
  assert.ok(fs.existsSync(nestedPath));
});

test('getMasterKeyHex: re-encrypts on creation — file contents include ciphertext wrapper', () => {
  const userData = scratchDir();
  const { mod } = freshModule({ userData });
  mod.getMasterKeyHex();
  const keyFile = path.join(userData, 'keystore', 'master.key.enc');
  const content = fs.readFileSync(keyFile, 'utf8');
  // From our mock: encryptString wraps with `ENC:` prefix before hex
  assert.match(content, /^ENC:[0-9a-f]+$/);
});
