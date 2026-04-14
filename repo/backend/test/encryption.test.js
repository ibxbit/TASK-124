'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const keystore = require('../src/crypto/keystore');
const {
  encrypt, decrypt, readVersion, last4,
  IV_LEN, VERSION_LEN, MIN_CIPHERTEXT_LEN
} = require('../src/crypto/encryption');

// Deterministic test keys
const KEY_V1 = crypto.randomBytes(32);
const KEY_V2 = crypto.randomBytes(32);

test.beforeEach(() => {
  keystore.__resetForTests();
  keystore.__setKeysForTests({ 1: KEY_V1, 2: KEY_V2 });
});

// ─── Round-trip ─────────────────────────────────────────────────────────────

test('round-trip: text is recovered exactly', () => {
  const plaintext = 'hello world';
  const { ciphertext } = encrypt(plaintext);
  assert.equal(decrypt(ciphertext), plaintext);
});

test('round-trip: preserves unicode and multi-line data', () => {
  const plaintext = '你好\n— secret 🔐\tok';
  const { ciphertext } = encrypt(plaintext);
  assert.equal(decrypt(ciphertext), plaintext);
});

test('round-trip: long plaintext (16 KB) works', () => {
  const plaintext = 'x'.repeat(16 * 1024);
  const { ciphertext } = encrypt(plaintext);
  assert.equal(decrypt(ciphertext), plaintext);
});

test('round-trip: short plaintext (1 byte) works', () => {
  const { ciphertext } = encrypt('a');
  assert.equal(decrypt(ciphertext), 'a');
});

test('ciphertext layout includes version header', () => {
  const { ciphertext } = encrypt('x');
  assert.equal(ciphertext.length >= MIN_CIPHERTEXT_LEN, true);
  assert.equal(readVersion(ciphertext), 2);  // current = highest = V2
});

// ─── IV generation: NO REUSE ────────────────────────────────────────────────

test('IVs are unique across 1000 encryptions of the same plaintext', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const { ciphertext } = encrypt('same text every time');
    const iv = ciphertext.subarray(VERSION_LEN, VERSION_LEN + IV_LEN).toString('hex');
    assert.equal(seen.has(iv), false, `IV collision detected after ${i} encryptions`);
    seen.add(iv);
  }
  assert.equal(seen.size, 1000);
});

test('identical plaintexts produce different ciphertexts', () => {
  const a = encrypt('same').ciphertext;
  const b = encrypt('same').ciphertext;
  assert.notDeepEqual(a, b);
});

// ─── Tampering detection ────────────────────────────────────────────────────

test('flipping a byte in the ciphertext body throws auth failure', () => {
  const { ciphertext } = encrypt('protect me');
  // Target a byte in the encrypted body, well past the header/iv/tag
  ciphertext[ciphertext.length - 1] ^= 0xFF;
  assert.throws(() => decrypt(ciphertext), /auth tag mismatch|tampered/);
});

test('flipping a byte in the auth tag throws', () => {
  const { ciphertext } = encrypt('protect me too');
  const tagStart = VERSION_LEN + IV_LEN;
  ciphertext[tagStart] ^= 0x01;
  assert.throws(() => decrypt(ciphertext), /tampered|auth/);
});

test('flipping a byte in the IV throws', () => {
  const { ciphertext } = encrypt('iv tampering');
  ciphertext[VERSION_LEN] ^= 0x01;
  assert.throws(() => decrypt(ciphertext), /tampered|auth/);
});

test('truncated ciphertext is rejected before key access', () => {
  assert.throws(() => decrypt(Buffer.alloc(5)), /too short/);
});

test('non-Buffer ciphertext is rejected', () => {
  assert.throws(() => decrypt('not a buffer'), /must be a Buffer/);
});

// ─── AAD (context binding) ─────────────────────────────────────────────────

test('AAD encrypt/decrypt round-trip succeeds', () => {
  const aad = 'financial_tokens:42';
  const { ciphertext } = encrypt('secret-token', { aad });
  assert.equal(decrypt(ciphertext, { aad }), 'secret-token');
});

test('AAD mismatch fails decryption (prevents ciphertext splicing)', () => {
  const { ciphertext } = encrypt('secret', { aad: 'row:100' });
  assert.throws(() => decrypt(ciphertext, { aad: 'row:101' }),
    /tampered|auth/);
});

test('missing AAD on decrypt when encrypt used AAD fails', () => {
  const { ciphertext } = encrypt('secret', { aad: 'ctx' });
  assert.throws(() => decrypt(ciphertext), /tampered|auth/);
});

test('AAD with Buffer input works the same as string', () => {
  const aadStr = 'ctx-value';
  const aadBuf = Buffer.from(aadStr, 'utf8');
  const { ciphertext } = encrypt('data', { aad: aadStr });
  assert.equal(decrypt(ciphertext, { aad: aadBuf }), 'data');
});

// ─── Key rotation ──────────────────────────────────────────────────────────

test('encrypt defaults to the highest version (current)', () => {
  const { ciphertext, keyVersion } = encrypt('rotate');
  assert.equal(keyVersion, 2);
  assert.equal(readVersion(ciphertext), 2);
});

test('can pin encryption to an explicit older version', () => {
  const { ciphertext, keyVersion } = encrypt('old', { keyVersion: 1 });
  assert.equal(keyVersion, 1);
  assert.equal(readVersion(ciphertext), 1);
  assert.equal(decrypt(ciphertext), 'old');
});

test('decrypt auto-selects key from ciphertext header', () => {
  const { ciphertext } = encrypt('hello', { keyVersion: 1 });
  assert.equal(decrypt(ciphertext), 'hello');  // no version passed
});

test('explicit key version overrides header (supports migrations)', () => {
  const { ciphertext } = encrypt('hello', { keyVersion: 1 });
  // Tamper the header to a version that exists but is wrong for this CT.
  ciphertext.writeUInt16BE(2, 0);
  // Passing the correct version explicitly should still decrypt.
  assert.equal(decrypt(ciphertext, { keyVersion: 1 }), 'hello');
});

test('decrypt with unknown key version throws descriptive error', () => {
  const { ciphertext } = encrypt('x', { keyVersion: 1 });
  assert.throws(() => decrypt(ciphertext, { keyVersion: 99 }),
    /No encryption key for version 99/);
});

// ─── Key validation ────────────────────────────────────────────────────────

test('keystore rejects all-zero key', () => {
  keystore.__resetForTests();
  assert.throws(
    () => keystore.__setKeysForTests({ 1: Buffer.alloc(32, 0) }),
    /all-zero/);
});

test('keystore rejects constant-byte (low-entropy) key', () => {
  keystore.__resetForTests();
  assert.throws(
    () => keystore.__setKeysForTests({ 1: Buffer.alloc(32, 0xAB) }),
    /constant-byte/);
});

test('keystore rejects wrong-length key', () => {
  assert.throws(
    () => keystore.parseHexKey('ab'.repeat(16), 'k'),   // 32 hex = 16 bytes
    /64 hex characters/);
});

test('keystore rejects non-hex key', () => {
  assert.throws(
    () => keystore.parseHexKey('z'.repeat(64), 'k'),
    /non-hex/);
});

test('keystore rejects duplicate key across two versions', () => {
  keystore.__resetForTests();
  const same = crypto.randomBytes(32);
  assert.throws(
    () => keystore.__setKeysForTests({ 1: same, 2: same }),
    /Duplicate key detected/);
});

// ─── Fingerprints + audit ──────────────────────────────────────────────────

test('fingerprint is deterministic 16-hex prefix of sha256(key)', () => {
  const fp = keystore.keyFingerprint(1);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(keystore.keyFingerprint(1), fp);   // stable
});

test('audit() lists all loaded versions with fingerprints, no key material', () => {
  const a = keystore.audit();
  assert.equal(a.loaded, true);
  assert.equal(a.current, 2);
  assert.equal(a.versions.length, 2);
  for (const v of a.versions) {
    assert.ok(Number.isInteger(v.version));
    assert.match(v.fingerprint, /^[0-9a-f]{16}$/);
    // Must not expose any 64-char key string
    assert.equal('key' in v, false);
  }
});

// ─── last4 masking helper ──────────────────────────────────────────────────

test('last4 returns last four characters for long strings', () => {
  assert.equal(last4('1234567890'), '7890');
});

test('last4 pads short strings with asterisks', () => {
  assert.equal(last4('ab'), '**ab');
});
