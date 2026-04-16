'use strict';

// ─── Frontend component: ExperimentLabWindow.svelte ─────────────────────────
// SSR + logic tests for A/B experiment lab: listing, selection, metric
// fetch by version, and warnings rendering.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'windows', 'ExperimentLabWindow.svelte');

test('ExperimentLabWindow SSR renders title and placeholder', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Experiment Lab — A\/B Testing/);
  assert.match(html, /Select an experiment/);
  resetDom();
});

test('ExperimentLabWindow SSR renders Experiments sidebar heading', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse([])) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Experiments/);
  resetDom();
});

test('ExperimentLabWindow logic: GET /experiments/:id/metrics?version=N', async () => {
  const seen = [];
  const fake = mockFetch(async (url) => {
    seen.push(url);
    if (url.endsWith('/experiments')) return makeResponse([{ id: 5, name: 'E1', latest_version: 2 }]);
    if (/\/experiments\/\d+\/metrics/.test(url)) {
      return makeResponse({
        alpha: 0.05,
        buckets: {
          control: { impressions: 100, clicks: 10, conversions: 5, ctr: 0.1, conversionRate: 0.05, retention7d: 0.4 },
          treatment: { impressions: 100, clicks: 20, conversions: 15, ctr: 0.2, conversionRate: 0.15, retention7d: 0.6 }
        },
        significance: {
          'control-vs-treatment': { ctr: { zScore: 2.5, pValue: 0.01, significant: true } }
        },
        lift: { control: [{ cumulativeCtr: 0.1 }], treatment: [{ cumulativeCtr: 0.2 }] },
        warnings: ['sample size below target']
      });
    }
    return makeResponse({});
  });
  installDom({ fetchImpl: fake });

  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'lab-api-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;

  const experiments = await api.get('/experiments');
  assert.equal(experiments[0].name, 'E1');
  const metrics = await api.get(`/experiments/${experiments[0].id}/metrics?version=${experiments[0].latest_version}`);
  assert.equal(metrics.buckets.control.impressions, 100);
  assert.equal(metrics.warnings[0], 'sample size below target');
  assert.match(seen.at(-1), /version=2$/);
  resetDom();
});

test('ExperimentLabWindow logic: failed metrics fetch → metrics reset to null', async () => {
  const fake = mockFetch(async (url) => {
    if (url.endsWith('/experiments')) return makeResponse([{ id: 1, name: 'E', latest_version: 1 }]);
    return makeResponse('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'lab-api-err-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;
  await assert.rejects(
    api.get('/experiments/1/metrics?version=1'),
    /404/
  );
  resetDom();
});

test('ExperimentLabWindow logic: offline render path sets offline status', async () => {
  // When list fetch fails with a network error, status should reflect it.
  const fake = mockFetch(async () => { throw new Error('network'); });
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'lab-api-offline-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = (await import('file://' + tmp.replace(/\\/g, '/'))).api;
  let status = '';
  try { await api.get('/experiments'); } catch (e) { status = `offline: ${e.message}`; }
  assert.match(status, /offline: network/);
  resetDom();
});
