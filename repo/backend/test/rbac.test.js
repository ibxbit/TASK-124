'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PERMISSIONS, ROLES, hasPermission } = require('../src/rbac/roles');

// ─── role catalogue ─────────────────────────────────────────────────────────

test('four roles exist', () => {
  assert.deepEqual(Object.keys(ROLES).sort(), ['admin','analyst','finance','moderator']);
});

test('every role has at least one permission', () => {
  for (const role of Object.values(ROLES)) {
    assert.ok(role.permissions.length > 0, `${role.name} has no permissions`);
  }
});

// ─── least privilege: every role's permissions are a disjoint set ────────────

test('no two non-admin roles share a non-dashboard permission', () => {
  const nonAdmin = Object.values(ROLES).filter(r => r.name !== 'admin');
  for (let i = 0; i < nonAdmin.length; i++) {
    for (let j = i + 1; j < nonAdmin.length; j++) {
      const shared = nonAdmin[i].permissions
        .filter(p => p !== PERMISSIONS.DASHBOARD_ACCESS)
        .filter(p => nonAdmin[j].permissions.includes(p));
      assert.equal(shared.length, 0,
        `${nonAdmin[i].name} and ${nonAdmin[j].name} share: ${shared.join(', ')}`);
    }
  }
});

// ─── admin capabilities ─────────────────────────────────────────────────────

test('admin can configure commission rules', () => {
  assert.equal(hasPermission('admin', PERMISSIONS.CONFIG_COMMISSION_RULES), true);
});

test('admin can manage experiments', () => {
  assert.equal(hasPermission('admin', PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS), true);
});

test('admin cannot issue refunds', () => {
  assert.equal(hasPermission('admin', PERMISSIONS.REFUND_ISSUE), false);
});

// ─── analyst capabilities ───────────────────────────────────────────────────

test('analyst can build queries', () => {
  assert.equal(hasPermission('analyst', PERMISSIONS.QUERY_BUILD), true);
});

test('analyst can export reports', () => {
  assert.equal(hasPermission('analyst', PERMISSIONS.REPORT_EXPORT), true);
});

test('analyst cannot run settlement', () => {
  assert.equal(hasPermission('analyst', PERMISSIONS.SETTLEMENT_RUN), false);
});

// ─── moderator capabilities ─────────────────────────────────────────────────

test('moderator can moderate content', () => {
  assert.equal(hasPermission('moderator', PERMISSIONS.CONTENT_MODERATE), true);
});

test('moderator can handle appeals', () => {
  assert.equal(hasPermission('moderator', PERMISSIONS.APPEAL_HANDLE), true);
});

test('moderator cannot export reports', () => {
  assert.equal(hasPermission('moderator', PERMISSIONS.REPORT_EXPORT), false);
});

// ─── finance capabilities ───────────────────────────────────────────────────

test('finance can run settlement', () => {
  assert.equal(hasPermission('finance', PERMISSIONS.SETTLEMENT_RUN), true);
});

test('finance can issue refunds', () => {
  assert.equal(hasPermission('finance', PERMISSIONS.REFUND_ISSUE), true);
});

test('finance cannot manage experiments', () => {
  assert.equal(hasPermission('finance', PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS), false);
});

// ─── dashboard access is shared ─────────────────────────────────────────────

test('all four roles have dashboard access', () => {
  for (const name of ['admin', 'analyst', 'moderator', 'finance']) {
    assert.equal(hasPermission(name, PERMISSIONS.DASHBOARD_ACCESS), true,
      `${name} should have dashboard:access`);
  }
});

// ─── unknown role / permission ──────────────────────────────────────────────

test('unknown role returns false (never grants)', () => {
  assert.equal(hasPermission('hacker', PERMISSIONS.CONFIG_RISK_RULES), false);
});

test('unknown permission on valid role returns false', () => {
  assert.equal(hasPermission('admin', 'nuclear:launch'), false);
});

test('null/undefined role returns false', () => {
  assert.equal(hasPermission(null, PERMISSIONS.DASHBOARD_ACCESS), false);
  assert.equal(hasPermission(undefined, PERMISSIONS.DASHBOARD_ACCESS), false);
});
