'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const checkpoints = require('../services/checkpointService');
const recovery = require('../services/recoveryService');
const memory = require('../services/memoryService');

async function adminRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.get('/admin/checkpoints/recent',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async (request) => checkpoints.listRecent(request.query?.limit));

  fastify.get('/admin/checkpoints/:kind/:key/latest',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async (request, reply) => {
      const c = await checkpoints.latest(request.params.kind, request.params.key);
      if (!c) return reply.code(404).send({ error: 'No checkpoint' });
      const integrity = checkpoints.verifyRow(c);
      return { ...c, integrity };
    });

  fastify.post('/admin/checkpoints/run-now',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async () => { await checkpoints.runOnce(); return { ok: true }; });

  fastify.post('/admin/recovery/restore',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (_request, reply) => {
      try { return await recovery.restoreAll(); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.get('/admin/recovery/events',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async (request) => recovery.listRecentEvents(request.query?.limit));

  fastify.get('/admin/health',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async () => memory.status());

  fastify.get('/admin/memory/status',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async () => memory.status());

  fastify.get('/admin/memory/alerts',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async (request) => memory.recentAlerts(request.query?.limit));

  fastify.post('/admin/memory/housekeeping',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async () => memory.housekeeping());

  // ── LAN allowlist management ──────────────────────────────────────────
  const lanSvc = require('../services/lanAllowlistService');

  fastify.get('/admin/lan-allowlist',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_LAN_ALLOWLIST)] },
    async () => lanSvc.list());

  fastify.post('/admin/lan-allowlist',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_LAN_ALLOWLIST)] },
    async (request, reply) => {
      try {
        const { ip, label } = request.body || {};
        return await lanSvc.add(ip, label, request.user.id);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.delete('/admin/lan-allowlist/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.MANAGE_LAN_ALLOWLIST)] },
    async (request) => lanSvc.remove(Number(request.params.id)));
}

module.exports = adminRoutes;
