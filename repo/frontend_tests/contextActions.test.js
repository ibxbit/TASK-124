'use strict';

// ─── Frontend: lib/contextActions.js ─────────────────────────────────────────
// Validates the row context-menu builder: label order, disabled state,
// delegation to clipboard and to consumer callbacks.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom } = require('./_dom');

async function loadActions(desktop) {
  installDom({ desktop });
  const mod = await import(
    'file://' +
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'contextActions.js').replace(/\\/g, '/')
  );
  return mod;
}

test('buildRowContextMenu returns three items in canonical order', async () => {
  const { buildRowContextMenu } = await loadActions();
  const items = buildRowContextMenu({
    cellValue: 'x', row: { id: 1, orderId: 'O1' },
    onOpenOrder: () => {}, onFlagAnomaly: () => {}
  });
  assert.deepEqual(items.map(i => i.label), [
    'Copy cell', 'Open related order', 'Flag anomaly'
  ]);
  resetDom();
});

test('Open related order is enabled when row has orderId', async () => {
  const { buildRowContextMenu } = await loadActions();
  const items = buildRowContextMenu({ cellValue: 'x', row: { orderId: 'O1' } });
  assert.equal(items[1].disabled, false);
  resetDom();
});

test('Open related order is disabled when row has no orderId', async () => {
  const { buildRowContextMenu } = await loadActions();
  const withoutOrderId = buildRowContextMenu({ cellValue: 'x', row: { id: 1 } });
  const withoutRow     = buildRowContextMenu({ cellValue: 'x' });
  assert.equal(withoutOrderId[1].disabled, true);
  assert.equal(withoutRow[1].disabled, true);
  resetDom();
});

test('Copy cell invokes clipboard.copyCell with the cell value', async () => {
  const { buildRowContextMenu } = await loadActions();
  const items = buildRowContextMenu({ cellValue: 'SEC-42', row: {} });
  await items[0].action();
  assert.equal(global.navigator.clipboard._state.last, 'SEC-42');
  resetDom();
});

test('Open related order calls consumer callback with orderId', async () => {
  const { buildRowContextMenu } = await loadActions();
  let opened = null;
  const items = buildRowContextMenu({
    cellValue: 'x', row: { orderId: 'ORD-99' },
    onOpenOrder: (id) => { opened = id; }
  });
  items[1].action();
  assert.equal(opened, 'ORD-99');
  resetDom();
});

test('Open related order is a no-op when no callback provided', async () => {
  const { buildRowContextMenu } = await loadActions();
  const items = buildRowContextMenu({ cellValue: 'x', row: { orderId: 'ORD-1' } });
  assert.doesNotThrow(() => items[1].action());
  resetDom();
});

test('Flag anomaly calls consumer callback with the full row', async () => {
  const { buildRowContextMenu } = await loadActions();
  let flagged = null;
  const row = { id: 7, reason: 'spam' };
  const items = buildRowContextMenu({
    cellValue: 'x', row, onFlagAnomaly: (r) => { flagged = r; }
  });
  items[2].action();
  assert.equal(flagged, row);
  resetDom();
});

test('Flag anomaly is a no-op when no callback provided', async () => {
  const { buildRowContextMenu } = await loadActions();
  const items = buildRowContextMenu({ cellValue: 'x', row: { id: 1 } });
  assert.doesNotThrow(() => items[2].action());
  resetDom();
});
