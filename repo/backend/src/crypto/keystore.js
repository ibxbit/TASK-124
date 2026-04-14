'use strict';

// Master-key resolver with rotation, validation, and keystore-file fallback.
//
// Resolution order (first match wins):
//   1.  MERCHANT_DB_KEY        → version 1
//       MERCHANT_DB_KEY_V<N>   → version N   (for rotation: V2, V3, …)
//   2.  MERCHANT_DB_KEY_FILE   → JSON file {"1":"hex64","2":"hex64",…}
//                                Used when the Electron keystore writes the
//                                master key to disk instead of an env var.
//
// Every loaded key is validated:
//   • exactly 32 bytes (AES-256)
//   • not all-zero
//   • not a constant-byte pattern
//   • no two versions share the same key (rotation invariant)
//
// Key material never enters a log line or error message. Only fingerprints —
// first 8 bytes of sha256(key), hex — are exposed.

const fs = require('fs');
const crypto = require('crypto');

const KEY_LEN = 32;

let keys = null;          // { version(Number) → Buffer(32) }
let fingerprints = null;  // { version → hex string }

// ── Validation ─────────────────────────────────────────────────────────────

function validateKeyBytes(buf, label) {
  if (!Buffer.isBuffer(buf) || buf.length !== KEY_LEN) {
    throw new Error(`${label}: must be exactly ${KEY_LEN} bytes (64 hex chars)`);
  }
  if (buf.every(b => b === 0)) {
    throw new Error(`${label}: all-zero key rejected`);
  }
  const first = buf[0];
  if (buf.every(b => b === first)) {
    throw new Error(`${label}: constant-byte key rejected (no entropy)`);
  }
}

function parseHexKey(hex, label) {
  if (typeof hex !== 'string' || hex.length !== KEY_LEN * 2) {
    throw new Error(`${label}: expected ${KEY_LEN * 2} hex characters`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${label}: non-hex characters rejected`);
  }
  const buf = Buffer.from(hex, 'hex');
  validateKeyBytes(buf, label);
  return buf;
}

function fingerprint(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

// ── Loading ────────────────────────────────────────────────────────────────

function loadFromEnv() {
  const out = {};
  if (process.env.MERCHANT_DB_KEY) {
    out[1] = parseHexKey(process.env.MERCHANT_DB_KEY, 'MERCHANT_DB_KEY');
  }
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^MERCHANT_DB_KEY_V(\d+)$/.exec(name);
    if (m && value) {
      const v = Number(m[1]);
      if (!Number.isInteger(v) || v < 1 || v > 0xFFFF) {
        throw new Error(`${name}: version must be integer 1..65535`);
      }
      out[v] = parseHexKey(value, name);
    }
  }
  return out;
}

function loadFromFile() {
  const file = process.env.MERCHANT_DB_KEY_FILE;
  if (!file) return null;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    throw new Error(`keystore file unreadable: ${err.code || err.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('keystore file is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('keystore file must contain an object {"<version>": "hex"}');
  }
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const ver = Number(k);
    if (!Number.isInteger(ver) || ver < 1) {
      throw new Error(`keystore file: invalid version key "${k}"`);
    }
    out[ver] = parseHexKey(v, `keystore.v${ver}`);
  }
  return out;
}

function assertDistinct(map) {
  const seen = new Map();
  for (const [v, buf] of Object.entries(map)) {
    const fp = fingerprint(buf);
    if (seen.has(fp)) {
      throw new Error(
        `Duplicate key detected: versions ${seen.get(fp)} and ${v} share fingerprint ${fp}. ` +
        `Every rotation must use a fresh key.`);
    }
    seen.set(fp, v);
  }
}

function load() {
  if (keys) return keys;
  let loaded = loadFromEnv();
  if (!Object.keys(loaded).length) {
    loaded = loadFromFile();
    if (!loaded || !Object.keys(loaded).length) {
      throw new Error(
        'No encryption keys available. Provide MERCHANT_DB_KEY (64 hex chars) ' +
        'or MERCHANT_DB_KEY_FILE pointing to a JSON keystore.');
    }
  }
  assertDistinct(loaded);
  keys = loaded;
  fingerprints = Object.fromEntries(
    Object.entries(loaded).map(([v, b]) => [v, fingerprint(b)]));
  return keys;
}

// ── Public API ─────────────────────────────────────────────────────────────

function getKey(version = 1) {
  const all = load();
  const key = all[version];
  if (!key) throw new Error(`No encryption key for version ${version}`);
  return key;
}

function currentVersion() {
  const all = load();
  return Math.max(...Object.keys(all).map(Number));
}

function keyFingerprint(version) {
  load();
  const fp = fingerprints[version];
  if (!fp) throw new Error(`No key for version ${version}`);
  return fp;
}

function audit() {
  try { load(); } catch { return { loaded: false, versions: [] }; }
  return {
    loaded: true,
    current: currentVersion(),
    versions: Object.keys(fingerprints).sort((a, b) => Number(a) - Number(b))
      .map(v => ({ version: Number(v), fingerprint: fingerprints[v] }))
  };
}

// ── Test hooks (never used in prod code paths) ─────────────────────────────

function __setKeysForTests(map) {
  for (const [v, b] of Object.entries(map)) {
    validateKeyBytes(b, `key.v${v}`);
  }
  assertDistinct(map);
  keys = { ...map };
  fingerprints = Object.fromEntries(
    Object.entries(map).map(([v, b]) => [v, fingerprint(b)]));
}

function __resetForTests() {
  keys = null;
  fingerprints = null;
}

module.exports = {
  getKey, currentVersion, keyFingerprint, audit,
  // exposed helpers used by encryption.js unit tests
  validateKeyBytes, parseHexKey, fingerprint,
  // test hooks
  __setKeysForTests, __resetForTests,
  KEY_LEN
};
