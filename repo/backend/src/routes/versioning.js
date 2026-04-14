'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const { getDb } = require('../db/pool');
const updates = require('../services/updateService');
const rollbackSvc = require('../services/rollbackService');
const snapshotSvc = require('../services/snapshotService');

async function versioningRoutes(fastify) {
  const auth = fastify.authenticate;

  // ── Version registry ────────────────────────────────────────────────
  // Exposes the normalized (id, version, applied_at, status) shape
  // through the v_versions view.
  fastify.get('/admin/versions',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async () => {
      const { rows } = await getDb().query(
        `SELECT id, version, applied_at, status
         FROM v_versions ORDER BY applied_at DESC NULLS LAST, id DESC`);
      return rows;
    });

  fastify.get('/admin/updates/current',
    { preHandler: [auth, requirePermission(PERMISSIONS.ADMIN_OPS)] },
    async () => updates.currentVersion());

  fastify.get('/admin/updates',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async () => updates.listVersions());

  // ── Import ──────────────────────────────────────────────────────────
  fastify.post('/admin/updates/import',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try {
        if (!request.isMultipart()) return reply.code(400).send({ error: 'multipart required' });
        let filename, buffer;
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            filename = part.filename;
            buffer = await part.toBuffer();
          }
        }
        if (!buffer) return reply.code(400).send({ error: 'file required' });
        return await updates.importPackage({ filename, buffer, userId: request.user.id });
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  // ── Apply (takes pre-update snapshot automatically) ─────────────────
  fastify.post('/admin/updates/:id/apply',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try { return await updates.applyVersion(Number(request.params.id), request.user.id); }
      catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  // ── Rollback: dry-run validator ─────────────────────────────────────
  fastify.get('/admin/updates/:id/rollback/validate',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request) => rollbackSvc.validate(Number(request.params.id)));

  // ── Rollback: execute ───────────────────────────────────────────────
  fastify.post('/admin/updates/:id/rollback',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try { return await updates.rollbackVersion(Number(request.params.id), request.user.id); }
      catch (err) {
        return reply.code(err.status || 500).send({
          error: err.message,
          details: err.details || null
        });
      }
    });

  // ── Snapshots ───────────────────────────────────────────────────────
  fastify.get('/admin/snapshots',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async () => snapshotSvc.listSnapshots());

  fastify.post('/admin/snapshots',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try {
        return await snapshotSvc.createSnapshot({
          userId: request.user.id,
          metadata: { reason: 'manual', note: request.body?.note || null }
        });
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });
}

module.exports = versioningRoutes;
