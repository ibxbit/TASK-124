'use strict';

const fs = require('fs');
const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const queryService = require('../services/queryService');
const savedQueries = require('../services/savedQueries');
const exportService = require('../services/exportService');

async function analyticsRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.post('/queries/execute',
    { preHandler: [auth, requirePermission(PERMISSIONS.QUERY_BUILD)] },
    async (request, reply) => {
      try { return await queryService.executeQuery(request.body || {}); }
      catch (err) { return reply.code(400).send({ error: err.message }); }
    });

  fastify.get('/queries/saved',
    { preHandler: [auth, requirePermission(PERMISSIONS.QUERY_SAVE)] },
    async (request) => savedQueries.list(request.user.id));

  fastify.post('/queries/saved',
    { preHandler: [auth, requirePermission(PERMISSIONS.QUERY_SAVE)] },
    async (request, reply) => {
      const { name, definition } = request.body || {};
      if (!name || !definition) return reply.code(400).send({ error: 'name and definition required' });
      return savedQueries.create(request.user.id, name, definition);
    });

  fastify.get('/queries/saved/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.QUERY_SAVE)] },
    async (request, reply) => {
      const q = await savedQueries.get(request.user.id, Number(request.params.id));
      if (!q) return reply.code(404).send({ error: 'Not found' });
      return q;
    });

  fastify.delete('/queries/saved/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.QUERY_SAVE)] },
    async (request) => {
      await savedQueries.remove(request.user.id, Number(request.params.id));
      return { ok: true };
    });

  fastify.post('/exports',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_EXPORT)] },
    async (request, reply) => {
      const { format, definition } = request.body || {};
      if (!format || !definition) return reply.code(400).send({ error: 'format and definition required' });
      try { return await exportService.createJob(request.user.id, format, definition); }
      catch (err) { return reply.code(400).send({ error: err.message }); }
    });

  fastify.get('/exports',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_EXPORT)] },
    async (request) => exportService.listJobs(request.user.id));

  fastify.get('/exports/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_EXPORT)] },
    async (request, reply) => {
      const job = await exportService.getJob(request.user.id, Number(request.params.id));
      if (!job) return reply.code(404).send({ error: 'Not found' });
      return job;
    });

  fastify.get('/exports/:id/download',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_EXPORT)] },
    async (request, reply) => {
      const job = await exportService.getJob(request.user.id, Number(request.params.id));
      if (!job) return reply.code(404).send({ error: 'Not found' });
      if (job.status !== 'completed') return reply.code(409).send({ error: `Job ${job.status}` });
      if (!fs.existsSync(job.file_path)) return reply.code(410).send({ error: 'File missing' });
      const mime = job.format === 'csv' ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      reply.header('Content-Type', mime);
      reply.header('Content-Disposition', `attachment; filename="export_${job.id}.${job.format}"`);
      return fs.createReadStream(job.file_path);
    });
}

module.exports = analyticsRoutes;
