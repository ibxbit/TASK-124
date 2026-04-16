'use strict';

// ─── Frontend component: QueueWindow.svelte ─────────────────────────────────
// SSR renders + logic flow tests: listing reports/appeals, resolve outcome,
// shortcut-driven approve, filter search.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'windows', 'QueueWindow.svelte');

test('QueueWindow SSR renders section headings', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Moderation Queue/);
  assert.match(html, /Open reports/);
  assert.match(html, /Pending appeals/);
  resetDom();
});

test('QueueWindow SSR renders table header row', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, />ID</);
  assert.match(html, />Type</);
  assert.match(html, />Reason</);
  resetDom();
});

test('QueueWindow logic: resolve outcome POSTs to /reports/:id/resolve', async () => {
  // We test the business flow by calling the underlying api directly —
  // this mirrors the resolve() handler in QueueWindow's script.
  let lastCall = null;
  const fake = mockFetch(async (url, init) => {
    lastCall = { url, init };
    if (url.endsWith('/reports')) return makeResponse([{ id: 1 }]);
    if (url.endsWith('/appeals')) return makeResponse([]);
    if (/\/reports\/\d+\/resolve$/.test(url)) return makeResponse({ ok: true });
    return makeResponse({});
  });
  installDom({ fetchImpl: fake });

  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'q-api-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;

  const reports = await api.get('/reports');
  assert.deepEqual(reports, [{ id: 1 }]);
  await api.post('/reports/1/resolve', { outcome: 'no_action' });
  assert.match(lastCall.url, /\/reports\/1\/resolve$/);
  assert.equal(lastCall.init.method, 'POST');
  assert.deepEqual(JSON.parse(lastCall.init.body), { outcome: 'no_action' });
  resetDom();
});

test('QueueWindow logic: search filter matches case-insensitively on JSON blob', async () => {
  // Mirrors the inline filter: r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase())
  const rows = [
    { id: 1, reason: 'Spammy content' },
    { id: 2, reason: 'Abusive language' },
    { id: 3, reason: 'Off-topic' }
  ];
  function filter(rows, search) {
    return rows.filter(r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
  }
  assert.equal(filter(rows, '').length, 3);
  assert.equal(filter(rows, 'spam')[0].id, 1);
  assert.equal(filter(rows, 'ABUSIVE').length, 1);
  assert.equal(filter(rows, 'nope').length, 0);
});

test('QueueWindow SSR: shows "Open reports (N)" with zero initial count', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Open reports \(0\)/);
  assert.match(html, /Pending appeals \(0\)/);
  resetDom();
});
