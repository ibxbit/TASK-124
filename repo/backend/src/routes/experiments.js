'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const expSvc = require('../services/experimentService');
const { computeMetrics } = require('../services/onlineMetrics');
const { evaluateRun } = require('../services/offlineMetrics');
const ingestion = require('../services/experimentIngestionService');

async function experimentRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.get('/experiments',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async () => expSvc.listExperiments());

  fastify.post('/experiments',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS)] },
    async (request, reply) => {
      const { name, description } = request.body || {};
      if (!name) return reply.code(400).send({ error: 'name required' });
      return expSvc.createExperiment(name, description);
    });

  fastify.post('/experiments/:id/versions',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS)] },
    async (request, reply) => {
      const { startTs, endTs, trafficSplit } = request.body || {};
      if (!startTs || !endTs || !trafficSplit) {
        return reply.code(400).send({ error: 'startTs, endTs, trafficSplit required' });
      }
      return expSvc.createVersion(Number(request.params.id), request.user.id, { startTs, endTs, trafficSplit });
    });

  fastify.get('/experiments/:id/assignment',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async (request, reply) => {
      const userId = request.query.userId;
      if (!userId) return reply.code(400).send({ error: 'userId required' });
      const a = await expSvc.getAssignment(Number(request.params.id), String(userId));
      if (!a) return reply.code(404).send({ error: 'No active version' });
      return a;
    });

  fastify.get('/experiments/:id/metrics',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async (request, reply) => {
      const version = Number(request.query.version);
      const alpha = request.query.alpha ? Number(request.query.alpha) : undefined;
      if (!version) return reply.code(400).send({ error: 'version required' });
      return computeMetrics(Number(request.params.id), version, { alpha });
    });

  fastify.post('/recommendations/evaluate',
    { preHandler: [auth, requirePermission(PERMISSIONS.RECOMMENDATION_EVALUATE)] },
    async (request, reply) => {
      const { runId } = request.body || {};
      if (!runId) return reply.code(400).send({ error: 'runId required' });
      return evaluateRun(Number(runId));
    });

  // ── Event log ingestion (admin-only — imported from CSV/batch sources) ────
  fastify.post('/experiments/events/ingest',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS)] },
    async (request, reply) => {
      try {
        const { events } = request.body || {};
        return await ingestion.ingestEvents(events);
      } catch (err) {
        return reply.code(err.status || 500).send({
          error: err.message,
          details: err.details || null
        });
      }
    });

  // ── Recommendation run ingestion (analyst/admin) ──────────────────────────
  fastify.post('/recommendations/runs/ingest',
    { preHandler: [auth, requirePermission(PERMISSIONS.RECOMMENDATION_EVALUATE)] },
    async (request, reply) => {
      try {
        return await ingestion.ingestRecommendationRun(request.body || {});
      } catch (err) {
        return reply.code(err.status || 500).send({
          error: err.message,
          details: err.details || null
        });
      }
    });
}

module.exports = experimentRoutes;
