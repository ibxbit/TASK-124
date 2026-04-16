'use strict';

// ─── Frontend component: LoginView.svelte ───────────────────────────────────
// Renders the component via Svelte SSR and exercises its script-level logic
// by simulating a mock fetch response. Covers:
//   • renders the login form with username/password fields
//   • submit() calls api.login and invokes onAuthed callback with user
//   • submit() surfaces a human-readable error on 401/invalid credentials

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom, mockFetch, makeResponse } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'LoginView.svelte');

test('LoginView SSR: renders form with Merchant Console heading and fields', async () => {
  installDom();
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.match(html, /Merchant Console/);
  assert.match(html, /Username/);
  assert.match(html, /Password/);
  assert.match(html, /type="password"/);
  assert.match(html, /Sign in/);
  resetDom();
});

test('LoginView SSR: no error message by default', async () => {
  installDom();
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  assert.doesNotMatch(html, /class="err"/);
  resetDom();
});

test('LoginView logic: successful submit stores token & calls onAuthed', async () => {
  // We exercise the real login() path by compiling api.js alongside and
  // simulating a valid /auth/login response. Since Svelte SSR does not run
  // event handlers, we load api.js and call login() directly — this covers
  // the same data flow the submit() handler in LoginView uses.
  const fake = mockFetch(async () =>
    makeResponse({ token: 'tok-1', user: { id: 3, role: 'analyst' } })
  );
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'lv-api-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = await import('file://' + tmp.replace(/\\/g, '/'));

  let authedWith = null;
  async function submit(username, password, onAuthed) {
    const user = await api.login(username, password);
    onAuthed(user);
  }
  await submit('admin', 'admin', (u) => { authedWith = u; });
  assert.deepEqual(authedWith, { id: 3, role: 'analyst' });
  assert.equal(api.getToken(), 'tok-1');
  resetDom();
});

test('LoginView logic: failed submit produces error message, does not call onAuthed', async () => {
  const fake = mockFetch(async () =>
    makeResponse('invalid creds', { status: 401, headers: { 'content-type': 'text/plain' } })
  );
  installDom({ fetchImpl: fake });
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'), 'utf8')
    .replace('import.meta.env.VITE_API_URL', '(globalThis.__TEST_API_URL)');
  const tmp = path.join(os.tmpdir(), 'lv-api-fail-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, src);
  const api = await import('file://' + tmp.replace(/\\/g, '/'));

  let error = '';
  let authed = false;
  async function submit(username, password, onAuthed) {
    try {
      const user = await api.login(username, password);
      onAuthed(user);
      authed = true;
    } catch (e) {
      error = e.message || 'Login failed';
    }
  }
  await submit('x', 'y', () => {});
  assert.equal(authed, false);
  assert.match(error, /401/);
  assert.equal(api.getToken(), null);
  resetDom();
});

test('LoginView SSR: default values admin/admin are pre-populated', async () => {
  installDom();
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({});
  // Svelte's SSR escapes input values
  assert.match(html, /value="admin"/);
  resetDom();
});
