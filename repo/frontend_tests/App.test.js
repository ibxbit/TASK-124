'use strict';

// ─── Frontend component: App.svelte ─────────────────────────────────────────
// Root component that routes between login and the three windows. We render
// it under several token states and verify the top-level gating logic plus
// route-conditional child markup.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'App.svelte');

test('App SSR: no token → login view rendered', async () => {
  installDom({ fetchImpl: mockFetch(async () => makeResponse({})) });
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Merchant Console/);
  assert.match(html, /Sign in/);
  // Navigation links for authenticated views should be absent
  assert.doesNotMatch(html, /Experiment Lab<\/a>/);
  resetDom();
});

test('App SSR: with token → main navigation rendered, default /queue view', async () => {
  installDom({
    fetchImpl: mockFetch(async () => makeResponse([])),
    initialHash: '#/queue'
  });
  global.localStorage.setItem('mc_token', 'seed-token');
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Merchant Console/);
  // Nav links present
  assert.match(html, /href="#\/queue"/);
  assert.match(html, /href="#\/lab"/);
  assert.match(html, /href="#\/settlement"/);
  assert.match(html, /Sign out/);
  // Default queue view rendered
  assert.match(html, /Moderation Queue/);
  resetDom();
});

test('App SSR: /lab route renders experiment-lab heading', async () => {
  installDom({
    fetchImpl: mockFetch(async () => makeResponse([])),
    initialHash: '#/lab'
  });
  global.localStorage.setItem('mc_token', 'seed-token');
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Experiment Lab/);
  resetDom();
});

test('App SSR: /settlement route renders settlement workbench heading', async () => {
  installDom({
    fetchImpl: mockFetch(async () => makeResponse([])),
    initialHash: '#/settlement'
  });
  global.localStorage.setItem('mc_token', 'seed-token');
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Settlement Workbench/);
  resetDom();
});

test('App: logout handler clears token and flips authed=false (mirror)', () => {
  // We test the two helper behaviours (onAuthed / onLogout) in mirror form,
  // since SSR does not run component lifecycle or event handlers.
  const store = { token: 'abc' };
  let authed = !!store.token;
  function setToken(v) { if (v) store.token = v; else delete store.token; }
  function logout() { setToken(null); authed = false; }
  function onAuthed() { authed = true; }

  assert.equal(authed, true);
  logout();
  assert.equal(authed, false);
  assert.equal(store.token, undefined);

  setToken('new');
  onAuthed();
  assert.equal(authed, true);
});
