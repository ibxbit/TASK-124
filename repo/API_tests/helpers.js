'use strict';

// Shared test bootstrap: builds a real Fastify app against the PGHOST database.
// Every test file imports getApp()/getToken() from here.

const bcrypt = require('bcryptjs');

// Set env before requiring any backend module
if (!process.env.PGHOST)     process.env.PGHOST     = process.env.TEST_PGHOST || 'localhost';
if (!process.env.PGPORT)     process.env.PGPORT     = process.env.TEST_PGPORT || '5432';
if (!process.env.PGUSER)     process.env.PGUSER     = 'merchant_app';
if (!process.env.PGPASSWORD) process.env.PGPASSWORD = 'merchant_app';
if (!process.env.PGDATABASE) process.env.PGDATABASE = 'merchant_console';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-minimum-16-chars';
if (!process.env.MERCHANT_DB_KEY) {
  process.env.MERCHANT_DB_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
}

const { build } = require('../backend/src/server');
const { getDb } = require('../backend/src/db/pool');
const { runAll: runMigrations } = require('../backend/src/db/migrate');

let app = null;

async function getApp() {
  if (app) return app;
  await runMigrations();
  app = await build();
  await seedTestUsers();
  return app;
}

async function seedTestUsers() {
  const db = getDb();
  const roles = ['admin', 'analyst', 'moderator', 'finance'];
  for (const role of roles) {
    const username = `test_${role}`;
    const hash = await bcrypt.hash('pass123', 4);
    await db.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING`,
      [username, hash, role]);
  }
}

async function getToken(app, role = 'admin') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: `test_${role}`, password: 'pass123' }
  });
  return JSON.parse(res.payload).token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function closeApp() {
  if (app) { await app.close(); app = null; }
}

module.exports = { getApp, getToken, authHeader, closeApp, getDb };
