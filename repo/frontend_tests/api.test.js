'use strict';

// ─── Frontend: lib/api.js ────────────────────────────────────────────────────
// Exercises the shared REST client: token persistence, auth headers,
// response parsing (JSON + text), error propagation, and auth helpers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { installDom, resetDom, makeResponse, mockFetch } = require('./_dom');

// `import.meta.env.VITE_API_URL` is Vite-specific. We transform the source to
// a Node-compatible equivalent, write it to a temp `.mjs`, then dynamic-import.
async function loadApi(fetchImpl) {
  installDom({ fetchImpl });
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.js'),
    'utf8'
  );
  const patched = src.replace(
    'import.meta.env.VITE_API_URL',
    "(globalThis.__TEST_API_URL)"
  );
  const tmp = path.join(os.tmpdir(), `api-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, patched);
  try {
    return await import('file://' + tmp.replace(/\\/g, '/'));
  } finally {
    // Cleanup: best-effort
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}

test('setToken stores in localStorage; getToken returns it', async () => {
  const mod = await loadApi();
  mod.setToken('abc123');
  assert.equal(mod.getToken(), 'abc123');
  assert.equal(global.localStorage.getItem('mc_token'), 'abc123');
  resetDom();
});

test('setToken(null) clears localStorage', async () => {
  const mod = await loadApi();
  mod.setToken('xyz');
  mod.setToken(null);
  assert.equal(mod.getToken(), null);
  assert.equal(global.localStorage.getItem('mc_token'), null);
  resetDom();
});

test('logout clears token', async () => {
  const mod = await loadApi();
  mod.setToken('t');
  mod.logout();
  assert.equal(mod.getToken(), null);
  resetDom();
});

test('api.get sends GET with no body and returns JSON', async () => {
  const fake = mockFetch(async () => makeResponse({ ok: 1 }));
  const mod = await loadApi(fake);
  const out = await mod.api.get('/status');
  assert.deepEqual(out, { ok: 1 });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.match(call.url, /\/status$/);
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.body, undefined);
  resetDom();
});

test('api.post serialises JSON body + Content-Type header', async () => {
  const fake = mockFetch(async () => makeResponse({ created: true }));
  const mod = await loadApi(fake);
  const out = await mod.api.post('/things', { a: 1 });
  assert.deepEqual(out, { created: true });
  const { init } = fake.calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.body, JSON.stringify({ a: 1 }));
  assert.equal(init.headers['Content-Type'], 'application/json');
  resetDom();
});

test('api.put/patch/delete cover all HTTP verbs', async () => {
  const seen = [];
  const fake = mockFetch(async (_url, init) => {
    seen.push(init.method);
    return makeResponse('', { status: 204, headers: { 'content-type': 'text/plain' } });
  });
  const mod = await loadApi(fake);
  await mod.api.put('/a', { x: 1 });
  await mod.api.patch('/a', { x: 2 });
  await mod.api.delete('/a');
  assert.deepEqual(seen, ['PUT', 'PATCH', 'DELETE']);
  resetDom();
});

test('request injects Authorization header when token set', async () => {
  const fake = mockFetch(async () => makeResponse({}));
  const mod = await loadApi(fake);
  mod.setToken('my-jwt');
  await mod.api.get('/secure');
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer my-jwt');
  resetDom();
});

test('request throws Error(`${status}: ${text}`) on non-2xx', async () => {
  const fake = mockFetch(async () =>
    makeResponse('Forbidden!', { status: 403, headers: { 'content-type': 'text/plain' } })
  );
  const mod = await loadApi(fake);
  await assert.rejects(
    mod.api.get('/admin/thing'),
    /403: Forbidden!/
  );
  resetDom();
});

test('request returns text when content-type is not JSON', async () => {
  const fake = mockFetch(async () =>
    makeResponse('plain text body', { headers: { 'content-type': 'text/plain' } })
  );
  const mod = await loadApi(fake);
  const body = await mod.api.get('/logs/raw');
  assert.equal(body, 'plain text body');
  resetDom();
});

test('login() stores returned token and returns user', async () => {
  const fake = mockFetch(async () =>
    makeResponse({ token: 'JWT.XYZ', user: { id: 1, role: 'admin' } })
  );
  const mod = await loadApi(fake);
  const user = await mod.login('admin', 'admin');
  assert.equal(user.role, 'admin');
  assert.equal(mod.getToken(), 'JWT.XYZ');
  // Subsequent request should send Authorization
  await mod.api.get('/me');
  assert.equal(fake.calls.at(-1).init.headers.Authorization, 'Bearer JWT.XYZ');
  resetDom();
});

test('login() propagates error on 401', async () => {
  const fake = mockFetch(async () =>
    makeResponse('bad password', { status: 401, headers: { 'content-type': 'text/plain' } })
  );
  const mod = await loadApi(fake);
  await assert.rejects(mod.login('x', 'y'), /401: bad password/);
  assert.equal(mod.getToken(), null);
  resetDom();
});

test('BASE URL falls back to 127.0.0.1:3131 when env not set', async () => {
  globalThis.__TEST_API_URL = undefined;
  const fake = mockFetch(async (url) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:3131\//);
    return makeResponse({});
  });
  const mod = await loadApi(fake);
  await mod.api.get('/health');
  resetDom();
});

test('BASE URL honours VITE_API_URL when set', async () => {
  globalThis.__TEST_API_URL = 'http://custom:9999';
  const fake = mockFetch(async (url) => {
    assert.match(url, /^http:\/\/custom:9999\//);
    return makeResponse({});
  });
  const mod = await loadApi(fake);
  await mod.api.get('/health');
  delete globalThis.__TEST_API_URL;
  resetDom();
});

test('request omits Authorization when no token set', async () => {
  const fake = mockFetch(async (_u, init) => {
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers['Content-Type'], 'application/json');
    return makeResponse({});
  });
  const mod = await loadApi(fake);
  mod.setToken(null);
  await mod.api.get('/public');
  resetDom();
});

test('request builds absolute URL by concatenating BASE + path', async () => {
  globalThis.__TEST_API_URL = 'http://api.internal:8080';
  const seen = [];
  const fake = mockFetch(async (url) => { seen.push(url); return makeResponse({}); });
  const mod = await loadApi(fake);
  await mod.api.get('/a/b');
  await mod.api.post('/c', {});
  assert.deepEqual(seen, ['http://api.internal:8080/a/b', 'http://api.internal:8080/c']);
  delete globalThis.__TEST_API_URL;
  resetDom();
});
