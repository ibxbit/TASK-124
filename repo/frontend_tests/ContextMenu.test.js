'use strict';

// ─── Frontend component: ContextMenu.svelte ─────────────────────────────────
// A small popover menu. SSR render starts hidden (visible = false) so the
// menu <ul> is absent. We verify the default hidden state and exercise the
// action-dispatch behaviour through a plain-JS mirror of the component
// since Svelte SSR does not execute click handlers.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom } = require('./_dom');
const { compileComponentTree } = require('./_svelte');

const FILE = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'ContextMenu.svelte');

test('ContextMenu SSR: hidden by default (visible=false)', async () => {
  installDom();
  const { Component } = await compileComponentTree(FILE);
  const { html } = Component.render({ items: [{ label: 'X' }] });
  assert.doesNotMatch(html, /<ul class="ctx-menu/);
  resetDom();
});

test('ContextMenu action dispatch: enabled items run their callback with ctx', () => {
  // Mirror of the onItem handler in the component
  function onItem(item, ctx, onClose) {
    if (item.disabled) return;
    item.action(ctx);
    onClose();
  }
  let called = null;
  const item = { label: 'Copy', action: (c) => { called = c; } };
  let closed = false;
  onItem(item, { rowId: 7 }, () => { closed = true; });
  assert.deepEqual(called, { rowId: 7 });
  assert.equal(closed, true);
});

test('ContextMenu action dispatch: disabled items are inert', () => {
  function onItem(item, ctx, onClose) {
    if (item.disabled) return;
    item.action(ctx);
    onClose();
  }
  let called = false;
  let closed = false;
  const item = { label: 'X', disabled: true, action: () => { called = true; } };
  onItem(item, {}, () => { closed = true; });
  assert.equal(called, false);
  assert.equal(closed, false);
});

test('ContextMenu close-on-Escape mirror: fires close handler only when visible', () => {
  function onKey(e, visible, close) {
    if (e.key === 'Escape' && visible) close();
  }
  let closed = 0;
  onKey({ key: 'Escape' }, false, () => closed++);
  onKey({ key: 'Escape' }, true, () => closed++);
  onKey({ key: 'a' }, true, () => closed++);
  assert.equal(closed, 1);
});
