'use strict';

const fp = require('fastify-plugin');
const jwt = require('@fastify/jwt');
const config = require('../config');

async function authPlugin(fastify) {
  await fastify.register(jwt, { secret: config.jwtSecret });

  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Invalid token' });
    }
  });
}

module.exports = fp(authPlugin);
