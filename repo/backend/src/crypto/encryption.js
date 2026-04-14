'use strict';

// AES-256-GCM field encryption with key rotation + AAD context binding.
//
//   ciphertext layout:
//     version (2 bytes, big-endian uint16)
//     iv      (12 bytes, CSPRNG)
//     tag     (16 bytes, GCM auth tag)
//     ct      (n bytes, ciphertext)
//
// Properties:
//   • 96-bit IVs from crypto.randomBytes — cryptographically secure, never
//     reused across encryptions (birthday-bound at ~2^32).
//   • Key version is embedded in the ciphertext, so rotations don't require
//     separately tracking it. decrypt() auto-selects the right key.
//   • Optional AAD (additional authenticated data) binds ciphertext to a
//     context — e.g. aad='financial_tokens:42' — so a ciphertext can't be
//     spliced from one row/table into another without authentication failure.
//   • Backward-compatible positional API: decrypt(ct, 2) or decrypt(ct, {keyVersion:2}).

const crypto = require('crypto');
const { getKey, currentVersion } = require('./keystore');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION_LEN = 2;
const MIN_CIPHERTEXT_LEN = VERSION_LEN + IV_LEN + TAG_LEN;

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeOpts(optOrVersion) {
  if (optOrVersion == null) return {};
  if (typeof optOrVersion === 'number') return { keyVersion: optOrVersion };
  if (typeof optOrVersion === 'object') return optOrVersion;
  throw new Error('options must be an object or key-version number');
}

function assertKeyVersion(v) {
  if (!Number.isInteger(v) || v < 1 || v > 0xFFFF) {
    throw new Error(`keyVersion must be integer in [1, 65535]`);
  }
}

function toAadBuffer(aad) {
  if (aad == null) return null;
  if (Buffer.isBuffer(aad)) return aad;
  return Buffer.from(String(aad), 'utf8');
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────

function encrypt(plaintext, optOrVersion) {
  if (plaintext == null) throw new Error('plaintext required');
  const opts = normalizeOpts(optOrVersion);
  const version = opts.keyVersion != null ? Number(opts.keyVersion) : currentVersion();
  assertKeyVersion(version);

  const key = getKey(version);
  const iv  = crypto.randomBytes(IV_LEN);         // fresh IV every call — never reused
  if (iv.length !== IV_LEN) throw new Error('IV length invariant violated');

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const aad = toAadBuffer(opts.aad);
  if (aad) cipher.setAAD(aad);

  const ct = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  const header = Buffer.allocUnsafe(VERSION_LEN);
  header.writeUInt16BE(version, 0);

  return {
    ciphertext: Buffer.concat([header, iv, tag, ct]),
    keyVersion: version
  };
}

function decrypt(ciphertext, optOrVersion) {
  if (!Buffer.isBuffer(ciphertext)) {
    throw new Error('ciphertext must be a Buffer');
  }
  if (ciphertext.length < MIN_CIPHERTEXT_LEN) {
    throw new Error(
      `ciphertext too short (${ciphertext.length} < ${MIN_CIPHERTEXT_LEN})`);
  }

  const opts = normalizeOpts(optOrVersion);
  const version = opts.keyVersion != null
    ? Number(opts.keyVersion)
    : ciphertext.readUInt16BE(0);
  assertKeyVersion(version);

  const key = getKey(version);
  const iv  = ciphertext.subarray(VERSION_LEN, VERSION_LEN + IV_LEN);
  const tag = ciphertext.subarray(VERSION_LEN + IV_LEN, VERSION_LEN + IV_LEN + TAG_LEN);
  const ct  = ciphertext.subarray(VERSION_LEN + IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  const aad = toAadBuffer(opts.aad);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    // Normalize GCM auth failures; never leak key or tag values.
    const e = new Error('decryption failed: auth tag mismatch or tampered ciphertext');
    e.cause = err;
    throw e;
  }
}

function last4(value) {
  const s = String(value);
  return s.length <= 4 ? s.padStart(4, '*') : s.slice(-4);
}

// Introspection helpers — used by the vault routes' audit responses.
function readVersion(ciphertext) {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < VERSION_LEN) return null;
  return ciphertext.readUInt16BE(0);
}

module.exports = {
  encrypt, decrypt, last4, readVersion,
  ALGO, IV_LEN, TAG_LEN, VERSION_LEN, MIN_CIPHERTEXT_LEN
};
