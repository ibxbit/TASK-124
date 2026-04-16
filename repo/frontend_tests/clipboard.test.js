'use strict';

// ─── Frontend: lib/clipboard.js ─────────────────────────────────────────────
// CSV serialisation edge cases + clipboard routing through Electron bridge
// and the browser fallback (navigator.clipboard).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installDom, resetDom } = require('./_dom');

async function loadClipboard(desktop) {
  installDom({ desktop });
  // No cachebust: clipboard.js is pure functional code with no module-level
  // side-effects to isolate, so one cached import gives proper coverage
  // attribution instead of N "different" tmp URLs.
  const mod = await import(
    'file://' +
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'clipboard.js').replace(/\\/g, '/')
  );
  return mod;
}

test('toCsv: renders header + row in CRLF', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n1,2\r\n3,4');
  resetDom();
});

test('toCsv: escapes quotes by doubling them and wrapping in quotes', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([{ v: 'he said "hi"' }], ['v']);
  assert.equal(csv, 'v\r\n"he said ""hi"""');
  resetDom();
});

test('toCsv: escapes commas and newlines by wrapping in quotes', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([{ v: 'a,b' }, { v: 'x\ny' }, { v: 'z\rw' }], ['v']);
  assert.equal(csv, 'v\r\n"a,b"\r\n"x\ny"\r\n"z\rw"');
  resetDom();
});

test('toCsv: renders null/undefined as empty field', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([{ a: null, b: undefined }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n,');
  resetDom();
});

test('toCsv: coerces non-strings to string', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([{ a: 42, b: true, c: { x: 1 } }], ['a', 'b', 'c']);
  assert.equal(csv, 'a,b,c\r\n42,true,[object Object]');
  resetDom();
});

test('toCsv: handles empty rows array', async () => {
  const { toCsv } = await loadClipboard();
  const csv = toCsv([], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n');
  resetDom();
});

test('copyAsCsv: writes via navigator.clipboard when no desktop bridge', async () => {
  const { copyAsCsv } = await loadClipboard();
  await copyAsCsv([{ a: 1 }], ['a']);
  assert.equal(global.navigator.clipboard._state.last, 'a\r\n1');
  resetDom();
});

test('copyAsCsv: writes via desktop bridge when present (Electron path)', async () => {
  const written = [];
  const desktop = { clipboard: { writeText: (t) => written.push(t) } };
  const { copyAsCsv } = await loadClipboard(desktop);
  await copyAsCsv([{ a: 1 }, { a: 2 }], ['a']);
  assert.equal(written.length, 1);
  assert.equal(written[0], 'a\r\n1\r\n2');
  // navigator should NOT have been used
  assert.equal(global.navigator.clipboard._state.last, null);
  resetDom();
});

test('copyCell: writes via navigator.clipboard when no desktop bridge', async () => {
  const { copyCell } = await loadClipboard();
  await copyCell('hello');
  assert.equal(global.navigator.clipboard._state.last, 'hello');
  resetDom();
});

test('copyCell: routes through Electron desktop.clipboard when present', async () => {
  const written = [];
  const desktop = { clipboard: { writeText: (t) => written.push(t) } };
  const { copyCell } = await loadClipboard(desktop);
  await copyCell('world');
  assert.deepEqual(written, ['world']);
  resetDom();
});

test('copyCell: coerces null/undefined to empty string', async () => {
  const written = [];
  const desktop = { clipboard: { writeText: (t) => written.push(t) } };
  const { copyCell } = await loadClipboard(desktop);
  await copyCell(null);
  await copyCell(undefined);
  await copyCell(0);
  assert.deepEqual(written, ['', '', '0']);
  resetDom();
});

test('copyAsCsv returns the generated CSV string', async () => {
  const { copyAsCsv } = await loadClipboard();
  const csv = await copyAsCsv([{ x: 'a' }, { x: 'b' }], ['x']);
  assert.equal(csv, 'x\r\na\r\nb');
  resetDom();
});
