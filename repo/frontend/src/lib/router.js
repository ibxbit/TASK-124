import { writable } from 'svelte/store';

function parse() {
  const hash = window.location.hash || '#/queue';
  return hash.replace(/^#/, '') || '/queue';
}

export const route = writable(parse());

window.addEventListener('hashchange', () => route.set(parse()));

export function navigate(path) {
  window.location.hash = path;
}
