'use strict';

// Minimal DOM + fetch + localStorage + clipboard shim for Node-based frontend tests.
// This avoids pulling in jsdom (large dependency) while providing enough of the
// browser surface that the frontend's lib/*.js modules can be exercised.

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) {
      if (listeners.has(type)) listeners.get(type).delete(cb);
    },
    dispatchEvent(event) {
      const type = event.type;
      const bucket = listeners.get(type);
      if (!bucket) return true;
      for (const cb of Array.from(bucket)) cb(event);
      return !event.defaultPrevented;
    }
  };
}

class KeyboardEventShim {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || '';
    this.ctrlKey = !!init.ctrlKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.metaKey = !!init.metaKey;
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
}

class HashChangeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.oldURL = init.oldURL || '';
    this.newURL = init.newURL || '';
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
}

function makeLocation(initialHash = '') {
  const loc = { _hash: initialHash };
  Object.defineProperty(loc, 'hash', {
    get() { return this._hash; },
    set(v) {
      const old = this._hash;
      this._hash = v.startsWith('#') ? v : (v === '' ? '' : '#' + v);
      if (old !== this._hash && typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: old, newURL: this._hash }));
      }
    }
  });
  return loc;
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null
  };
}

function makeClipboard() {
  const state = { last: null };
  return {
    writeText: async (text) => { state.last = text; },
    readText: async () => state.last,
    _state: state
  };
}

// Install globals onto the global namespace so modules that reference
// window/document/localStorage/fetch can be required into Node.
function installDom({ initialHash = '', fetchImpl, desktop } = {}) {
  const window = Object.assign(createEventTarget(), {
    location: makeLocation(initialHash),
    innerWidth: 1280,
    innerHeight: 900
  });
  const document = {
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        href: '',
        download: '',
        style: {},
        click() { this._clicked = true; }
      };
      return node;
    }
  };
  const localStorage = makeStorage();
  const clipboard = makeClipboard();

  // Some Node versions define `navigator` as a read-only getter on globalThis,
  // so we always use defineProperty with configurable:true for consistency.
  const setGlobal = (key, value) => {
    Object.defineProperty(global, key, { value, writable: true, configurable: true });
  };
  setGlobal('window', window);
  setGlobal('document', document);
  setGlobal('localStorage', localStorage);
  setGlobal('navigator', { clipboard });
  setGlobal('KeyboardEvent', KeyboardEventShim);
  setGlobal('HashChangeEvent', HashChangeEvent);
  // Simple URL.createObjectURL stub
  if (typeof global.URL.createObjectURL !== 'function') {
    global.URL.createObjectURL = () => 'blob:stub/' + Math.random().toString(36).slice(2);
  }
  setGlobal('fetch', fetchImpl || (async () => makeResponse(null)));
  if (desktop) global.window.desktop = desktop;

  return { window, document, localStorage, navigator: global.navigator };
}

function resetDom() {
  for (const key of ['window', 'document', 'localStorage', 'navigator', 'fetch', 'KeyboardEvent', 'HashChangeEvent']) {
    try { delete global[key]; }
    catch { /* some Node versions forbid delete of navigator; best-effort */ }
  }
}

// Minimal Response-like object for mock fetch
function makeResponse(body, { status = 200, headers = {} } = {}) {
  const hdrs = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (!hdrs.has('content-type')) hdrs.set('content-type', 'application/json');
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `Status ${status}`,
    headers: { get: (k) => hdrs.get(k.toLowerCase()) || null },
    text: async () => bodyStr,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    blob: async () => ({ size: bodyStr.length, text: async () => bodyStr })
  };
}

// Build a fetch mock that records calls + returns canned responses.
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const res = await handler(url, init);
    if (res && typeof res === 'object' && 'ok' in res) return res;
    return makeResponse(res);
  };
  fn.calls = calls;
  return fn;
}

module.exports = { installDom, resetDom, makeResponse, mockFetch };
