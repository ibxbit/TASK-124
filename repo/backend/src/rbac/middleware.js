'use strict';

const { hasPermission } = require('./roles');
const { writeAuditLog } = require('../audit/logger');

function requirePermission(permission) {
  return async function (request, reply) {
    const user = request.user;
    if (!user || !user.role) {
      await writeAuditLog({
        userId: null, role: null, action: permission,
        resource: request.url, method: request.method,
        status: 'denied', reason: 'unauthenticated', ip: request.ip
      });
      return reply.code(401).send({ error: 'Unauthenticated' });
    }

    if (!hasPermission(user.role, permission)) {
      await writeAuditLog({
        userId: user.id, role: user.role, action: permission,
        resource: request.url, method: request.method,
        status: 'denied', reason: 'insufficient_privilege', ip: request.ip
      });
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await writeAuditLog({
      userId: user.id, role: user.role, action: permission,
      resource: request.url, method: request.method,
      status: 'allowed', reason: null, ip: request.ip
    });
  };
}

module.exports = { requirePermission };
