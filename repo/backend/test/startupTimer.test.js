'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');

const { StartupTimer, TARGET_INTERACTIVE_MS } =
  require('../src/services/startupTimer');

test('constructor auto-records a "boot" mark', () => {
  const t = new StartupTimer();
  const s = t.summary();
  assert.equal(s.totalMs, 0);
  assert.equal(s.phases.length, 0);
});

test('summary reports per-phase durations', async () => {
  const t = new StartupTimer();
  await sleep(5);
  t.mark('a');
  await sleep(5);
  t.mark('b');

  const s = t.summary();
  assert.equal(s.phases.length, 2);
  assert.equal(s.phases[0].phase, 'a');
  assert.equal(s.phases[1].phase, 'b');
  assert.ok(s.phases[0].ms >= 1, `expected a to take ≥1ms, got ${s.phases[0].ms}`);
  assert.ok(s.phases[1].ms >= 1, `expected b to take ≥1ms, got ${s.phases[1].ms}`);
  assert.ok(s.totalMs >= 5);
});

test('interactiveMs is the time to the "listening" mark', async () => {
  const t = new StartupTimer();
  await sleep(2);
  t.mark('pg_started');
  await sleep(2);
  t.mark('migrations');
  await sleep(2);
  t.mark('app_built');
  await sleep(2);
  t.mark('listening');
  await sleep(10);                               // simulated post-listen work
  t.mark('recovery_done');

  const s = t.summary();
  // interactiveMs ≈ 8ms (up to 'listening'); totalMs ≈ 18ms
  assert.ok(s.interactiveMs >= 4 && s.interactiveMs < s.totalMs);
  assert.ok(s.totalMs >= s.interactiveMs + 8);
});

test('withinTarget is true below 5s', async () => {
  const t = new StartupTimer();
  await sleep(5);
  t.mark('listening');
  const s = t.summary();
  assert.equal(s.withinTarget, true);
  assert.equal(s.target, TARGET_INTERACTIVE_MS);
});

test('time() wraps an async task and records it as a phase', async () => {
  const t = new StartupTimer();
  await t.time('work', async () => { await sleep(5); });
  const s = t.summary();
  assert.equal(s.phases.length, 1);
  assert.equal(s.phases[0].phase, 'work');
  assert.ok(s.phases[0].ms >= 4);
});

test('summary tolerates having only a single mark', () => {
  const t = new StartupTimer();
  const s = t.summary();
  assert.equal(s.phases.length, 0);
  assert.equal(s.interactiveMs, 0);
});

test('TARGET_INTERACTIVE_MS is 5000 (5-second startup goal)', () => {
  assert.equal(TARGET_INTERACTIVE_MS, 5_000);
});
