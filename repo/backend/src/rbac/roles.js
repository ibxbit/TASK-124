'use strict';

// Permission catalogue + role-to-permission mapping (least-privilege)
const PERMISSIONS = {
  // Admin
  CONFIG_COMMISSION_RULES:     'config:commission_rules',
  CONFIG_RISK_RULES:           'config:risk_rules',
  CONFIG_MODERATION_POLICIES:  'config:moderation_policies',
  MANAGE_EXPERIMENT_VERSIONS:  'experiment:manage_versions',
  ADMIN_OPS:                   'admin:ops',              // internal/operational endpoints
  MANAGE_LAN_ALLOWLIST:        'admin:lan_allowlist',    // approved-machine management

  // Analyst
  QUERY_BUILD:              'query:build',
  QUERY_SAVE:               'query:save',
  REPORT_EXPORT:            'report:export',
  RECOMMENDATION_EVALUATE:  'recommendation:evaluate',
  DASHBOARD_ACCESS:         'dashboard:access',

  // Moderator
  REPORT_HANDLE:   'report:handle',
  APPEAL_HANDLE:   'appeal:handle',
  DISPUTE_MANAGE:  'dispute:manage',
  CONTENT_MODERATE: 'content:moderate',

  // Finance
  SETTLEMENT_RUN:         'settlement:run',
  REFUND_ISSUE:           'refund:issue',
  RECONCILIATION_EXPORT:  'reconciliation:export'
};

const ROLES = {
  admin: {
    name: 'admin',
    permissions: [
      PERMISSIONS.CONFIG_COMMISSION_RULES,
      PERMISSIONS.CONFIG_RISK_RULES,
      PERMISSIONS.CONFIG_MODERATION_POLICIES,
      PERMISSIONS.MANAGE_EXPERIMENT_VERSIONS,
      PERMISSIONS.ADMIN_OPS,
      PERMISSIONS.MANAGE_LAN_ALLOWLIST,
      PERMISSIONS.DASHBOARD_ACCESS,
      PERMISSIONS.REFUND_ISSUE
    ]
  },
  analyst: {
    name: 'analyst',
    permissions: [
      PERMISSIONS.QUERY_BUILD,
      PERMISSIONS.QUERY_SAVE,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.RECOMMENDATION_EVALUATE,
      PERMISSIONS.DASHBOARD_ACCESS
    ]
  },
  moderator: {
    name: 'moderator',
    permissions: [
      PERMISSIONS.REPORT_HANDLE,
      PERMISSIONS.APPEAL_HANDLE,
      PERMISSIONS.DISPUTE_MANAGE,
      PERMISSIONS.CONTENT_MODERATE,
      PERMISSIONS.DASHBOARD_ACCESS
    ]
  },
  finance: {
    name: 'finance',
    permissions: [
      PERMISSIONS.SETTLEMENT_RUN,
      PERMISSIONS.REFUND_ISSUE,
      PERMISSIONS.RECONCILIATION_EXPORT,
      PERMISSIONS.DASHBOARD_ACCESS
    ]
  }
};

function hasPermission(roleName, permission) {
  const role = ROLES[roleName];
  return !!role && role.permissions.includes(permission);
}

module.exports = { PERMISSIONS, ROLES, hasPermission };
