'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const followSvc = require('../services/followService');
const likeSvc = require('../services/likeService');
const commentSvc = require('../services/commentService');
const reportSvc = require('../services/contentReportService');
const admin = require('../services/adminControlService');

async function engagementRoutes(fastify) {
  const auth = fastify.authenticate;

  // Follows
  fastify.post('/follows', { preHandler: [auth] }, async (request, reply) => {
    try {
      const { followeeId } = request.body || {};
      if (!followeeId) return reply.code(400).send({ error: 'followeeId required' });
      return await followSvc.follow(String(request.user.id), String(followeeId));
    } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.delete('/follows/:followeeId', { preHandler: [auth] }, async (request) =>
    followSvc.unfollow(String(request.user.id), String(request.params.followeeId)));

  fastify.get('/users/:id/followers', { preHandler: [auth] },
    async (request) => followSvc.listFollowers(String(request.params.id)));

  fastify.get('/users/:id/following', { preHandler: [auth] },
    async (request) => followSvc.listFollowing(String(request.params.id)));

  // Likes
  fastify.post('/likes', { preHandler: [auth] }, async (request, reply) => {
    try { return await likeSvc.addLike(String(request.user.id), request.body || {}); }
    catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.delete('/likes', { preHandler: [auth] }, async (request, reply) => {
    try { return await likeSvc.removeLike(String(request.user.id), request.body || {}); }
    catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.get('/likes/count', { preHandler: [auth] }, async (request, reply) => {
    try {
      const { targetType, targetId, kind } = request.query;
      return { count: await likeSvc.count({ targetType, targetId: Number(targetId), kind }) };
    } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  // Comments (multipart-friendly)
  fastify.post('/comments', { preHandler: [auth] }, async (request, reply) => {
    try {
      let body = '', targetType, targetId, parentId;
      const images = [];
      if (request.isMultipart()) {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const buf = await part.toBuffer();
            images.push({ buffer: buf, size: buf.length, mime: part.mimetype });
          } else {
            if (part.fieldname === 'body')       body = String(part.value);
            if (part.fieldname === 'targetType') targetType = String(part.value);
            if (part.fieldname === 'targetId')   targetId = Number(part.value);
            if (part.fieldname === 'parentId')   parentId = Number(part.value);
          }
        }
      } else {
        ({ body = '', targetType, targetId, parentId } = request.body || {});
      }
      return await commentSvc.createComment(String(request.user.id), {
        body, targetType, targetId, parentId, images
      });
    } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.get('/comments', { preHandler: [auth] }, async (request, reply) => {
    const { targetType, targetId } = request.query;
    if (!targetType || !targetId) return reply.code(400).send({ error: 'targetType and targetId required' });
    return commentSvc.listThread(String(targetType), Number(targetId));
  });

  // Reports + appeals
  fastify.post('/reports', { preHandler: [auth] }, async (request, reply) => {
    try { return await reportSvc.createReport(String(request.user.id), request.body || {}); }
    catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.get('/reports',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_HANDLE)] },
    async () => reportSvc.listOpenReports());

  fastify.post('/reports/:id/resolve',
    { preHandler: [auth, requirePermission(PERMISSIONS.REPORT_HANDLE)] },
    async (request, reply) => {
      try {
        return await reportSvc.resolveReport(
          Number(request.params.id), request.user.id, request.body?.outcome);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.post('/reports/:id/appeals', { preHandler: [auth] }, async (request, reply) => {
    try {
      const { reason } = request.body || {};
      if (!reason) return reply.code(400).send({ error: 'reason required' });
      return await reportSvc.submitAppeal(
        Number(request.params.id), String(request.user.id), reason);
    } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
  });

  fastify.get('/content-appeals',
    { preHandler: [auth, requirePermission(PERMISSIONS.APPEAL_HANDLE)] },
    async () => reportSvc.listAppeals());

  fastify.post('/content-appeals/:id/resolve',
    { preHandler: [auth, requirePermission(PERMISSIONS.APPEAL_HANDLE)] },
    async (request, reply) => {
      try {
        return await reportSvc.resolveAppeal(
          Number(request.params.id), request.user.id, request.body?.outcome);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  // Admin blacklists + throttle policies
  fastify.get('/admin/blacklists',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request) => admin.listBlacklist(request.query?.kind));

  fastify.post('/admin/blacklists',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try {
        const { kind, value } = request.body || {};
        return await admin.addBlacklist(kind, value, request.user.id);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });

  fastify.delete('/admin/blacklists/:id',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request) => admin.removeBlacklist(Number(request.params.id)));

  fastify.get('/admin/throttle-policies',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async () => admin.listThrottlePolicies());

  fastify.put('/admin/throttle-policies/:key',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_MODERATION_POLICIES)] },
    async (request, reply) => {
      try {
        const { maxCount, windowSeconds } = request.body || {};
        return await admin.setThrottlePolicy(
          request.params.key, Number(maxCount), Number(windowSeconds), request.user.id);
      } catch (err) { return reply.code(err.status || 500).send({ error: err.message }); }
    });
}

module.exports = engagementRoutes;
