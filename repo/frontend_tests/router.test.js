'use strict';

// ─── Frontend: lib/router.js ────────────────────────────────────────────────
// Validates the tiny hash-router's default path, parse-on-hashchange behaviour,
// navigate() integration, and store subscription.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom } = require('./_dom');

async function loadRouter(initialHash = '') {
  installDom({ initialHash });
  // bust ESM cache — the router attaches a hashchange listener on import; we
  // want a fresh one per test so event streams don't bleed across tests.
  const mod = await import(
    'file://' +
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'router.js').replace(/\\/g, '/') +
    '?t=' + Date.now() + Math.random()
  );
  return mod;
}

function readStore(store) {
  let val;
  const unsub = store.subscribe((v) => { val = v; });
  unsub();
  return val;
}

test('default path is /queue when no hash is set', async () => {
  const { route } = await loadRouter('');
  assert.equal(readStore(route), '/queue');
  resetDom();
});

test('parses hash fragment as current route', async () => {
  const { route } = await loadRouter('#/lab');
  assert.equal(readStore(route), '/lab');
  resetDom();
});

test('navigate() updates window.location.hash and the store', async () => {
  const { route, navigate } = await loadRouter('#/queue');
  const seen = [];
  const unsub = route.subscribe((v) => seen.push(v));
  navigate('/settlement');
  unsub();
  assert.equal(window.location.hash, '#/settlement');
  assert.deepEqual(seen, ['/queue', '/settlement']);
  resetDom();
});

test('hashchange event updates the store without navigate()', async () => {
  const { route } = await loadRouter('#/queue');
  const seen = [];
  const unsub = route.subscribe((v) => seen.push(v));
  window.location.hash = '#/lab';
  unsub();
  assert.deepEqual(seen, ['/queue', '/lab']);
  resetDom();
});

test('navigate() handles successive route changes', async () => {
  const { route, navigate } = await loadRouter('');
  const order = [];
  route.subscribe((v) => order.push(v))();
  navigate('/lab');
  navigate('/settlement');
  navigate('/queue');
  assert.deepEqual(order, ['/queue']);
  assert.equal(window.location.hash, '#/queue');
  resetDom();
});

test('empty hash (#) collapses to /queue default', async () => {
  const { route } = await loadRouter('#');
  assert.equal(readStore(route), '/queue');
  resetDom();
});
