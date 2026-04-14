'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/pool');

async function authRoutes(fastify) {
  fastify.post('/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) return reply.code(400).send({ error: 'Missing credentials' });

    const { rows } = await getDb().query(
      `SELECT id, username, password_hash, role FROM users
       WHERE username=$1 AND active=true`, [username]);
    if (!rows.length) return reply.code(401).send({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: '12h' }
    );
    return { token, user: { id: user.id, username: user.username, role: user.role } };
  });

  fastify.post('/auth/register',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      // Only admin may create accounts
      if (request.user.role !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { username, password, role } = request.body || {};
      if (!username || !password || !role) {
        return reply.code(400).send({ error: 'username, password, role required' });
      }
      if (!['admin','analyst','moderator','finance'].includes(role)) {
        return reply.code(400).send({ error: 'Invalid role' });
      }
      const hash = await bcrypt.hash(password, 10);
      try {
        const { rows } = await getDb().query(
          `INSERT INTO users (username, password_hash, role)
           VALUES ($1,$2,$3) RETURNING id, username, role`,
          [username, hash, role]);
        return rows[0];
      } catch (err) {
        if (err.code === '23505') return reply.code(409).send({ error: 'Username exists' });
        throw err;
      }
    });

  fastify.get('/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request) => request.user);
}

module.exports = authRoutes;
