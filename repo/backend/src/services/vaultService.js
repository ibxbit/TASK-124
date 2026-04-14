'use strict';

const { getDb } = require('../db/pool');
const { encrypt, decrypt, last4 } = require('../crypto/encryption');

async function storeCredential(userId, label, secret) {
  const { ciphertext, keyVersion } = encrypt(secret);
  const { rows } = await getDb().query(
    `INSERT INTO sensitive_credentials (user_id, label, ciphertext, last4, key_version)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, label)
     DO UPDATE SET ciphertext=EXCLUDED.ciphertext, last4=EXCLUDED.last4, key_version=EXCLUDED.key_version
     RETURNING id, label, last4, created_at`,
    [userId, label, ciphertext, last4(secret), keyVersion]);
  return rows[0];
}

async function revealCredential(userId, label) {
  const { rows } = await getDb().query(
    `SELECT ciphertext, key_version FROM sensitive_credentials WHERE user_id=$1 AND label=$2`,
    [userId, label]);
  if (!rows.length) return null;
  return decrypt(rows[0].ciphertext, rows[0].key_version);
}

async function listCredentials(userId) {
  const { rows } = await getDb().query(
    `SELECT id, label, last4, created_at FROM sensitive_credentials WHERE user_id=$1`,
    [userId]);
  return rows;
}

async function storeFinancialToken(opts) {
  const { ownerType, ownerId, tokenType, secret } = opts;
  const { ciphertext, keyVersion } = encrypt(secret);
  const { rows } = await getDb().query(
    `INSERT INTO financial_tokens (owner_type, owner_id, token_type, ciphertext, last4, key_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, owner_type, owner_id, token_type, last4, created_at`,
    [ownerType, ownerId, tokenType, ciphertext, last4(secret), keyVersion]);
  return rows[0];
}

async function listFinancialTokens(ownerType, ownerId) {
  const { rows } = await getDb().query(
    `SELECT id, token_type, last4, created_at FROM financial_tokens
     WHERE owner_type=$1 AND owner_id=$2 ORDER BY created_at DESC`,
    [ownerType, ownerId]);
  return rows;
}

// Returns metadata (no secret) for ownership checks at the route layer
async function getFinancialTokenMeta(id) {
  const { rows } = await getDb().query(
    `SELECT id, owner_type, owner_id, token_type, last4 FROM financial_tokens WHERE id=$1`, [id]);
  return rows[0] || null;
}

async function revealFinancialToken(id) {
  const { rows } = await getDb().query(
    `SELECT ciphertext, key_version FROM financial_tokens WHERE id=$1`, [id]);
  if (!rows.length) return null;
  return decrypt(rows[0].ciphertext, rows[0].key_version);
}

module.exports = {
  storeCredential, revealCredential, listCredentials,
  storeFinancialToken, revealFinancialToken, listFinancialTokens,
  getFinancialTokenMeta
};
