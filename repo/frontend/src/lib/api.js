// Central REST client. All windows share server-authoritative state.
const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3131';

let token = localStorage.getItem('mc_token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('mc_token', t);
  else   localStorage.removeItem('mc_token');
}
export function getToken() { return token; }

async function request(method, path, body, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra.headers || {})
  };
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export const api = {
  get:    (p)    => request('GET',    p),
  post:   (p, b) => request('POST',   p, b),
  put:    (p, b) => request('PUT',    p, b),
  patch:  (p, b) => request('PATCH',  p, b),
  delete: (p)    => request('DELETE', p)
};

export async function login(username, password) {
  const res = await api.post('/auth/login', { username, password });
  setToken(res.token);
  return res.user;
}

export function logout() { setToken(null); }
