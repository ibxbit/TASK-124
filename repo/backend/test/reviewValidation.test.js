'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, MAX_TAGS, MAX_BODY } = require('../src/services/reviewValidation');

function valid() {
  return {
    orderLineItemId: 'OLI-1', orderId: 'ORD-1',
    reviewerId: 'u1', deviceId: 'dev-1',
    rating: 4, tags: ['quality', 'value'], body: 'Solid product.'
  };
}

// ─── valid review ───────────────────────────────────────────────────────────

test('valid review returns no errors', () => {
  assert.deepEqual(validate(valid()), []);
});

test('optional body can be omitted', () => {
  const r = valid(); delete r.body;
  assert.deepEqual(validate(r), []);
});

test('tags can be empty array', () => {
  const r = valid(); r.tags = [];
  assert.deepEqual(validate(r), []);
});

// ─── required fields ────────────────────────────────────────────────────────

test('missing orderLineItemId', () => {
  const r = valid(); delete r.orderLineItemId;
  assert.ok(validate(r).some(e => /orderLineItemId/.test(e)));
});

test('missing orderId', () => {
  const r = valid(); delete r.orderId;
  assert.ok(validate(r).some(e => /orderId/.test(e)));
});

test('missing reviewerId', () => {
  const r = valid(); delete r.reviewerId;
  assert.ok(validate(r).some(e => /reviewerId/.test(e)));
});

test('missing deviceId', () => {
  const r = valid(); delete r.deviceId;
  assert.ok(validate(r).some(e => /deviceId/.test(e)));
});

// ─── rating bounds ──────────────────────────────────────────────────────────

test('rating 0 fails', () => {
  const r = valid(); r.rating = 0;
  assert.ok(validate(r).some(e => /rating/.test(e)));
});

test('rating 6 fails', () => {
  const r = valid(); r.rating = 6;
  assert.ok(validate(r).some(e => /rating/.test(e)));
});

test('rating 1 passes', () => {
  const r = valid(); r.rating = 1;
  assert.deepEqual(validate(r), []);
});

test('rating 5 passes', () => {
  const r = valid(); r.rating = 5;
  assert.deepEqual(validate(r), []);
});

test('non-integer rating fails', () => {
  const r = valid(); r.rating = 3.5;
  assert.ok(validate(r).some(e => /rating/.test(e)));
});

test('NaN rating fails', () => {
  const r = valid(); r.rating = 'bad';
  assert.ok(validate(r).some(e => /rating/.test(e)));
});

// ─── tags cap ───────────────────────────────────────────────────────────────

test(`exactly ${MAX_TAGS} tags is allowed`, () => {
  const r = valid(); r.tags = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
  assert.deepEqual(validate(r), []);
});

test(`${MAX_TAGS + 1} tags fails`, () => {
  const r = valid(); r.tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`);
  assert.ok(validate(r).some(e => /tags/.test(e)));
});

test('non-array tags fails', () => {
  const r = valid(); r.tags = 'oops';
  assert.ok(validate(r).some(e => /tags/.test(e)));
});

// ─── body length cap ────────────────────────────────────────────────────────

test(`body at ${MAX_BODY} chars passes`, () => {
  const r = valid(); r.body = 'x'.repeat(MAX_BODY);
  assert.deepEqual(validate(r), []);
});

test(`body at ${MAX_BODY + 1} chars fails`, () => {
  const r = valid(); r.body = 'x'.repeat(MAX_BODY + 1);
  assert.ok(validate(r).some(e => /body/.test(e)));
});

// ─── multiple errors accumulate ─────────────────────────────────────────────

test('all fields missing returns multiple error messages', () => {
  const errors = validate({});
  assert.ok(errors.length >= 5);
});
