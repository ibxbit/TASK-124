'use strict';

const authRoutes          = require('./auth');
const analyticsRoutes     = require('./analytics');
const experimentRoutes    = require('./experiments');
const reviewRoutes        = require('./reviews');
const engagementRoutes    = require('./engagement');
const vaultRoutes         = require('./vault');
const financeRoutes       = require('./finance');
const refundRoutes        = require('./refunds');
const reconciliationRoutes = require('./reconciliation');
const versioningRoutes    = require('./versioning');
const adminRoutes         = require('./admin');

async function routes(fastify) {
  await fastify.register(authRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(experimentRoutes);
  await fastify.register(reviewRoutes);
  await fastify.register(engagementRoutes);
  await fastify.register(vaultRoutes);
  await fastify.register(financeRoutes);
  await fastify.register(refundRoutes);
  await fastify.register(reconciliationRoutes);
  await fastify.register(versioningRoutes);
  await fastify.register(adminRoutes);
}

module.exports = routes;
