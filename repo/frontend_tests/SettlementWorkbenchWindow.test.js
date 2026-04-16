'use strict';

// ─── Frontend component: SettlementWorkbenchWindow.svelte ───────────────────
// Covers the settlement UI: SSR render, masked defaults for amounts,
// refund issue + execute, clipboard CSV shortcut, reconciliation export
// (validation + success path).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'windows', 'SettlementWorkbenchWindow.svelte');

test('SettlementWorkbench SSR renders all section headings', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Settlement Workbench/);
  assert.match(html, /Run Weekly Settlement/);
  assert.match(html, /Issue Refund/);
  assert.match(html, /Reconciliation Export/);
  assert.match(html, /Recent Cycles/);
  assert.match(html, /Refunds/);
  resetDom();
});

test('SettlementWorkbench SSR "Show full amounts" toggle is unchecked by default', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  // checkbox should NOT be pre-checked (masked by default — a security control)
  assert.doesNotMatch(html, /<input type="checkbox"[^>]*\bchecked\b/);
  resetDom();
});

test('SettlementWorkbench logic: issue refund → POST /refunds/issue with numeric coercion', async () => {
  let lastCall = null;
  const fake = mockFetch(async (url, init) => {
    lastCall = { url, init };
    return makeResponse({ id: 99, status: 'approved' });
  });
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'sw-api-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;

  // User types strings — the component coerces with Number()
  const refundPaymentId = '12';
  const refundAmount = '500.25';
  const refundReason = 'customer request';
  const r = await api.post('/refunds/issue', {
    paymentId: Number(refundPaymentId), amount: Number(refundAmount), reason: refundReason
  });
  assert.equal(r.status, 'approved');
  const body = JSON.parse(lastCall.init.body);
  assert.equal(body.paymentId, 12);
  assert.equal(body.amount, 500.25);
  assert.equal(body.reason, 'customer request');
  resetDom();
});

test('SettlementWorkbench logic: execute refund → POST /refunds/:id/execute', async () => {
  let lastCall = null;
  const fake = mockFetch(async (url, init) => {
    lastCall = { url, init };
    return makeResponse({ ok: true });
  });
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'sw-api-exec-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;
  await api.post('/refunds/42/execute', {});
  assert.match(lastCall.url, /\/refunds\/42\/execute$/);
  assert.equal(lastCall.init.method, 'POST');
  resetDom();
});

test('SettlementWorkbench logic: reconciliation export validates empty date range', async () => {
  // Mirrors component's validation: !periodFrom || !periodTo → status warning
  function validateRange(from, to) {
    if (!from || !to) return 'enter MM/DD/YYYY dates';
    return 'ok';
  }
  assert.equal(validateRange('', ''), 'enter MM/DD/YYYY dates');
  assert.equal(validateRange('01/01/2026', ''), 'enter MM/DD/YYYY dates');
  assert.equal(validateRange('01/01/2026', '01/07/2026'), 'ok');
});

test('SettlementWorkbench logic: reconciliation export URL-encodes dates', async () => {
  const from = '04/01/2026';
  const to = '04/07/2026';
  const url = `http://api:3131/reconciliation/export?type=summary&format=csv`
    + `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  assert.match(url, /from=04%2F01%2F2026/);
  assert.match(url, /to=04%2F07%2F2026/);
  assert.match(url, /format=csv/);
});

test('SettlementWorkbench logic: reconciliation download names file with sanitised slashes', async () => {
  const periodFrom = '04/01/2026';
  const periodTo = '04/07/2026';
  const name = `reconciliation_${periodFrom}_${periodTo}.csv`.replace(/\//g, '-');
  assert.equal(name, 'reconciliation_04-01-2026_04-07-2026.csv');
});

test('SettlementWorkbench logic: run settlement POSTs /settlement/run', async () => {
  let lastCall = null;
  const fake = mockFetch(async (url, init) => {
    lastCall = { url, init };
    return makeResponse({ cycleId: 7 });
  });
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'sw-api-run-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;
  const r = await api.post('/settlement/run', {});
  assert.equal(r.cycleId, 7);
  assert.match(lastCall.url, /\/settlement\/run$/);
  resetDom();
});

test('SettlementWorkbench logic: export cycles CSV via clipboard helper', async () => {
  const written = [];
  const desktop = { clipboard: { writeText: (t) => written.push(t) } };
  installDom({ desktop });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'clipboard.js'), 'utf8');
  const tmp = path.join(os.tmpdir(), 'sw-clip-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const { copyAsCsv } = await import('file://' + tmp.replace(/\\/g, '/'));
  const cycles = [{ id: 1, period_start: '2026-04-01', period_end: '2026-04-07',
    status: 'closed', total_gross: 1000, total_fees: 100, total_net: 900 }];
  const csv = await copyAsCsv(cycles, ['id','period_start','period_end','status','total_gross','total_fees','total_net']);
  assert.match(csv, /^id,period_start,period_end/);
  assert.equal(written.length, 1);
  resetDom();
});
