'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const refundSvc = require('../services/refundService');
const risk = require('../services/riskService');

async function refundRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.post('/refunds/issue',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      try { return await refundSvc.createRefund(request.body || {}, request.user.id); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/refunds',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request) => refundSvc.listRefunds(request.query || {}));

  fastify.patch('/refunds/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      try { return await refundSvc.editRefund(Number(request.params.id), request.body || {}, request.user.id); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/refunds/:id/approve',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      try { return await refundSvc.approveRefund(Number(request.params.id), request.user.id, request.body?.note); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/refunds/:id/reject',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      try { return await refundSvc.rejectRefund(Number(request.params.id), request.user.id, request.body?.note); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/refunds/:id/execute',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      try { return await refundSvc.executeRefund(Number(request.params.id), request.user.id); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/refunds/:id/audit',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request) => refundSvc.getAudit(Number(request.params.id)));

  fastify.get('/risk-rules',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async () => risk.listRules());

  fastify.put('/risk-rules/:key',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_RISK_RULES)] },
    async (request, reply) => {
      try {
        const { value } = request.body || {};
        return await risk.setRule(request.params.key, Number(value), request.user.id);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });
}

module.exports = refundRoutes;
