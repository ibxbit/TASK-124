'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const reviewSvc = require('../services/reviewService');
const modSvc = require('../services/moderationService');

async function reviewRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.post('/reviews', { preHandler: [auth] }, async (request, reply) => {
    try {
      // Bind reviewer identity from token — never trust the body
      const input = { ...(request.body || {}), reviewerId: String(request.user.id) };
      return await reviewSvc.createReview(input);
    } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.get('/reviews',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONTENT_MODERATE)] },
    async (request) => reviewSvc.listReviews(request.query || {}));

  fastify.get('/reviews/:id', { preHandler: [auth] }, async (request, reply) => {
    const r = await reviewSvc.getReview(Number(request.params.id));
    if (!r) return reply.code(404).send({ error: 'Not found' });
    return r;
  });

  fastify.post('/reviews/:id/hide',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONTENT_MODERATE)] },
    async (request) => modSvc.hideReview(Number(request.params.id), request.user.id, request.body?.reason));

  fastify.post('/reviews/:id/restore',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONTENT_MODERATE)] },
    async (request) => modSvc.restoreReview(Number(request.params.id), request.user.id, request.body?.reason));

  fastify.post('/reviews/:id/appeals', { preHandler: [auth] }, async (request, reply) => {
    const reason = request.body?.reason;
    if (!reason) return reply.code(400).send({ error: 'reason required' });
    // Pass authenticated user ID — not body-supplied identity
    return modSvc.submitAppeal(Number(request.params.id), reason, String(request.user.id));
  });

  fastify.get('/appeals',
    { preHandler: [auth, requirePermission(PERMISSIONS.APPEAL_HANDLE)] },
    async (request) => modSvc.listAppeals(request.query || {}));

  fastify.post('/appeals/:id/resolve',
    { preHandler: [auth, requirePermission(PERMISSIONS.APPEAL_HANDLE)] },
    async (request, reply) => {
      try {
        const { outcome, reason } = request.body || {};
        return await modSvc.resolveAppeal(Number(request.params.id), request.user.id, outcome, reason);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/reviews/:id/decisions',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONTENT_MODERATE)] },
    async (request) => modSvc.getDecisionLog(Number(request.params.id)));
}

module.exports = reviewRoutes;
