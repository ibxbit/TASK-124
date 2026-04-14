'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const importSvc = require('../services/importService');
const paymentSvc = require('../services/paymentService');
const fees = require('../services/feeCalculator');
const settlement = require('../services/settlementService');

async function financeRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.post('/finance/imports',
    { preHandler: [auth, requirePermission(PERMISSIONS.SETTLEMENT_RUN)] },
    async (request, reply) => {
      try {
        if (!request.isMultipart()) return reply.code(400).send({ error: 'multipart required' });
        let source, format, filename, buffer;
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            filename = part.filename;
            format = (part.filename || '').toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
            buffer = await part.toBuffer();
          } else if (part.fieldname === 'source') {
            source = String(part.value);
          }
        }
        if (!source || !buffer) return reply.code(400).send({ error: 'source and file required' });
        return await importSvc.importFile({
          source, format, filename, buffer, userId: request.user.id
        });
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/finance/payments',
    { preHandler: [auth, requirePermission(PERMISSIONS.SETTLEMENT_RUN)] },
    async (request, reply) => {
      try {
        const { couponCode, ...p } = request.body || {};
        const r = await paymentSvc.createPayment(p, { couponCode });
        if (!r) return reply.code(409).send({ error: 'Duplicate external_id' });
        return r;
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/finance/payments/:id/transition',
    { preHandler: [auth, requirePermission(PERMISSIONS.SETTLEMENT_RUN)] },
    async (request, reply) => {
      try {
        const { toState, reason } = request.body || {};
        return await paymentSvc.transition(
          Number(request.params.id), toState, request.user.id, reason);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/finance/commission-rates',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async () => fees.listCommissionRates());

  fastify.put('/finance/commission-rates',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_COMMISSION_RULES)] },
    async (request, reply) => {
      try {
        const { provider, rate } = request.body || {};
        return await fees.setCommissionRate(provider || null, Number(rate), request.user.id);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/settlement/run',
    { preHandler: [auth, requirePermission(PERMISSIONS.SETTLEMENT_RUN)] },
    async (request, reply) => {
      try { return await settlement.runCycle(request.user.id); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/settlement/cycles',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async () => settlement.listCycles());

  fastify.get('/settlement/cycles/:id/lines',
    { preHandler: [auth, requirePermission(PERMISSIONS.DASHBOARD_ACCESS)] },
    async (request) => settlement.getCycleLines(Number(request.params.id)));
}

module.exports = financeRoutes;
