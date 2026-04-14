'use strict';

const { PERMISSIONS } = require('../rbac/roles');
const { requirePermission } = require('../rbac/middleware');
const vault = require('../services/vaultService');

async function vaultRoutes(fastify) {
  const auth = fastify.authenticate;

  fastify.post('/vault/credentials', { preHandler: [auth] }, async (request, reply) => {
    const { label, secret } = request.body || {};
    if (!label || !secret) return reply.code(400).send({ error: 'label and secret required' });
    return vault.storeCredential(request.user.id, label, secret);
  });

  fastify.get('/vault/credentials', { preHandler: [auth] },
    async (request) => vault.listCredentials(request.user.id));

  fastify.get('/vault/credentials/:label/reveal',
    { preHandler: [auth, requirePermission(PERMISSIONS.CONFIG_COMMISSION_RULES)] },
    async (request, reply) => {
      const v = await vault.revealCredential(request.user.id, request.params.label);
      if (v == null) return reply.code(404).send({ error: 'Not found' });
      return { value: v };
    });

  fastify.post('/vault/financial-tokens',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      const { ownerType, ownerId, tokenType, secret } = request.body || {};
      if (!ownerType || !ownerId || !tokenType || !secret) {
        return reply.code(400).send({ error: 'ownerType, ownerId, tokenType, secret required' });
      }
      return vault.storeFinancialToken({ ownerType, ownerId, tokenType, secret });
    });

  fastify.get('/vault/financial-tokens',
    { preHandler: [auth, requirePermission(PERMISSIONS.RECONCILIATION_EXPORT)] },
    async (request) =>
      vault.listFinancialTokens(request.query.ownerType, request.query.ownerId));

  fastify.get('/vault/financial-tokens/:id/reveal',
    { preHandler: [auth, requirePermission(PERMISSIONS.REFUND_ISSUE)] },
    async (request, reply) => {
      const id = Number(request.params.id);
      // Object-level authorization: verify the token belongs to the
      // requester's scope. Admin can reveal any; finance can only reveal
      // tokens they stored (owner_id matches their user id).
      const meta = await vault.getFinancialTokenMeta(id);
      if (!meta) return reply.code(404).send({ error: 'Not found' });
      const isAdmin = request.user.role === 'admin';
      const isOwner = String(meta.owner_id) === String(request.user.id);
      if (!isAdmin && !isOwner) {
        return reply.code(403).send({ error: 'Not authorized to reveal this token' });
      }
      const v = await vault.revealFinancialToken(id);
      if (v == null) return reply.code(404).send({ error: 'Not found' });
      return { value: v };
    });
}

module.exports = vaultRoutes;
