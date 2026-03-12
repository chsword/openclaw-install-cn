'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { compareSemver } = require('../commands/upgrade');

describe('compareSemver', () => {
  test('equal versions return 0', () => {
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  });

  test('higher major returns 1', () => {
    assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  });

  test('lower major returns -1', () => {
    assert.equal(compareSemver('1.0.0', '2.0.0'), -1);
  });

  test('higher minor returns 1', () => {
    assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  });

  test('higher patch returns 1', () => {
    assert.equal(compareSemver('1.0.2', '1.0.1'), 1);
  });

  test('handles v prefix', () => {
    assert.equal(compareSemver('v1.2.3', '1.2.3'), 0);
  });

  test('supports date-like versions', () => {
    assert.equal(compareSemver('2026.3.8', '2026.3.7'), 1);
  });
});
