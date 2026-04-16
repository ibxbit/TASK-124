'use strict';

// ─── Frontend component: AuditLogWindow.svelte ──────────────────────────────
// Renders audit log list, filters rows by action/user, highlights denied rows.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'windows', 'AuditLogWindow.svelte');

test('AuditLogWindow SSR: renders heading, filter input, and refresh button', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /System Audit Log/);
  assert.match(html, /Filter by action or user/);
  assert.match(html, /Refresh/);
  resetDom();
});

test('AuditLogWindow SSR: renders table column headers', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  for (const col of ['Time', 'User', 'Role', 'Action', 'Resource', 'Status']) {
    assert.match(html, new RegExp(`>${col}<`));
  }
  resetDom();
});

test('AuditLogWindow filter logic: case-insensitive substring on JSON blob', () => {
  const rows = [
    { id: 1, user_id: 42, action: 'LOGIN',   resource: 'auth', status: 'granted' },
    { id: 2, user_id: 42, action: 'EXPORT',  resource: 'csv',  status: 'denied' },
    { id: 3, user_id: 11, action: 'REFUND',  resource: 'r/42', status: 'granted' }
  ];
  function filter(rows, q) {
    return rows.filter(l => !q || JSON.stringify(l).toLowerCase().includes(q.toLowerCase()));
  }
  assert.equal(filter(rows, 'export').length, 1);
  assert.equal(filter(rows, 'DENIED').length, 1);
  assert.equal(filter(rows, '42').length, 3);
  assert.equal(filter(rows, '').length, 3);
});

test('AuditLogWindow denied-row styling mirror', () => {
  // The template applies class="denied" when status === 'denied'
  function rowClass(log) { return log.status === 'denied' ? 'denied' : ''; }
  assert.equal(rowClass({ status: 'denied' }), 'denied');
  assert.equal(rowClass({ status: 'granted' }), '');
  assert.equal(rowClass({ status: null }), '');
});

test('AuditLogWindow fallback for missing user_id / role (template defaults)', () => {
  // Template: `{l.user_id || 'System'}` and `{l.role || '-'}`
  const pipe = (v) => (v || 'System');
  const pipeRole = (v) => (v || '-');
  assert.equal(pipe(null), 'System');
  assert.equal(pipe(0), 'System');
  assert.equal(pipe(42), 42);
  assert.equal(pipeRole(null), '-');
  assert.equal(pipeRole('admin'), 'admin');
});
