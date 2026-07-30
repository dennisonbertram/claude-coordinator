'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { mean, median } = require('../src/stats');

test('mean of [1,2,3] is 2', () => {
  assert.strictEqual(mean([1, 2, 3]), 2);
});

test('mean of [10] is 10', () => {
  assert.strictEqual(mean([10]), 10);
});

test('median of odd-length array picks the middle value', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
});
