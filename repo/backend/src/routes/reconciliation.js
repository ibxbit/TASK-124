'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const recon = require('../services/reconciliationService');

async function reconciliationRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.get('/reconciliation/export',
    { preHandler: [auth, requirePermission(PERMISSIONS.RECONCILIATION_EXPORT)] },
    async (request, reply) => {
      try {
        const { type = 'summary', format = 'csv', from, to } = request.query || {};
        const { stream, filename, mime, rowCount } =
          await recon.buildReport({ type, format, fromDate: from, toDate: to });
        reply.header('Content-Type', mime);
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Row-Count', String(rowCount));
        return reply.send(stream);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });
}

module.exports = reconciliationRoutes;
