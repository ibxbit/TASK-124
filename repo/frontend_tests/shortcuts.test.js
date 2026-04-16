'use strict';

// ─── Frontend: lib/shortcuts.js ────────────────────────────────────────────
// Covers the keyboard shortcut registry: accelerator parsing, modifier
// combinations, handler dispatch, unregister, preventDefault, and the
// Electron IPC bridge ("desktop.onShortcut") channel forwarding.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom } = require('./_dom');

async function loadShortcuts(desktop) {
  installDom({ desktop });
  const mod = await import(
    'file://' +
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'shortcuts.js').replace(/\\/g, '/') +
    '?t=' + Date.now() + Math.random()
  );
  return mod;
}

function press(key, { ctrlKey = false, shiftKey = false, altKey = false } = {}) {
  const ev = new KeyboardEvent('keydown', { key, ctrlKey, shiftKey, altKey });
  window.dispatchEvent(ev);
  return ev;
}

test('registerShortcut + matching accelerator triggers handler', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('s1', 'Ctrl+K', () => { hit++; });
  initShortcuts();
  press('k', { ctrlKey: true });
  assert.equal(hit, 1);
  resetDom();
});

test('non-matching keystroke does not trigger handler', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('s1', 'Ctrl+K', () => { hit++; });
  initShortcuts();
  press('j', { ctrlKey: true });
  press('k'); // no ctrl
  press('k', { shiftKey: true, ctrlKey: true }); // extra shift
  assert.equal(hit, 0);
  resetDom();
});

test('Ctrl+Return matches the Enter key', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('approve', 'Ctrl+Return', () => { hit++; });
  initShortcuts();
  press('Enter', { ctrlKey: true });
  assert.equal(hit, 1);
  resetDom();
});

test('Ctrl+Shift+E matches full modifier combination', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('exp', 'Ctrl+Shift+E', () => { hit++; });
  initShortcuts();
  press('e', { ctrlKey: true, shiftKey: true });
  assert.equal(hit, 1);
  // ctrl only should NOT fire
  press('e', { ctrlKey: true });
  assert.equal(hit, 1);
  resetDom();
});

test('registered handler is called with the event object + preventDefault is invoked', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let gotEvent = null;
  registerShortcut('s', 'Ctrl+K', (e) => { gotEvent = e; });
  initShortcuts();
  const ev = press('k', { ctrlKey: true });
  assert.equal(gotEvent, ev);
  assert.equal(ev.defaultPrevented, true);
  resetDom();
});

test('unregisterShortcut removes the handler', async () => {
  const { registerShortcut, unregisterShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('s1', 'Ctrl+K', () => { hit++; });
  initShortcuts();
  unregisterShortcut('s1');
  press('k', { ctrlKey: true });
  assert.equal(hit, 0);
  resetDom();
});

test('only the first matching handler fires (early return)', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  const order = [];
  registerShortcut('a', 'Ctrl+K', () => order.push('a'));
  registerShortcut('b', 'Ctrl+K', () => order.push('b'));
  initShortcuts();
  press('k', { ctrlKey: true });
  assert.equal(order.length, 1);
  resetDom();
});

test('desktop.onShortcut channel triggers known-name handlers', async () => {
  const channels = {};
  const desktop = {
    onShortcut: (channel, cb) => { channels[channel] = cb; }
  };
  const { registerShortcut, initShortcuts } = await loadShortcuts(desktop);
  const calls = [];
  registerShortcut('globalSearch',  'Ctrl+K',      () => calls.push('search'));
  registerShortcut('approveAction', 'Ctrl+Return', () => calls.push('approve'));
  registerShortcut('exportData',    'Ctrl+Shift+E',() => calls.push('export'));
  initShortcuts();
  channels['shortcut:global-search']();
  channels['shortcut:approve']();
  channels['shortcut:export']();
  assert.deepEqual(calls, ['search', 'approve', 'export']);
  resetDom();
});

test('desktop.onShortcut paths are safe when handler not registered yet', async () => {
  const channels = {};
  const desktop = { onShortcut: (ch, cb) => { channels[ch] = cb; } };
  const { initShortcuts } = await loadShortcuts(desktop);
  initShortcuts();
  // No handler registered — should not throw
  assert.doesNotThrow(() => channels['shortcut:global-search']());
  assert.doesNotThrow(() => channels['shortcut:approve']());
  assert.doesNotThrow(() => channels['shortcut:export']());
  resetDom();
});

test('Alt modifier dimension is enforced', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('alt', 'Alt+F', () => { hit++; });
  initShortcuts();
  press('f', { altKey: true });
  press('f');
  press('f', { altKey: true, ctrlKey: true });
  assert.equal(hit, 1);
  resetDom();
});

test('case-insensitive key matching', async () => {
  const { registerShortcut, initShortcuts } = await loadShortcuts();
  let hit = 0;
  registerShortcut('u', 'ctrl+U', () => { hit++; });
  initShortcuts();
  press('U', { ctrlKey: true }); // capital U
  assert.equal(hit, 1);
  resetDom();
});
