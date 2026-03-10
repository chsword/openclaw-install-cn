'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Re-require the logger fresh for each test group via a helper so that the
// module-level `_verbose` flag does not bleed between tests.
function freshLogger() {
  // Delete the cached module so we get a clean slate.
  const key = require.resolve('../lib/logger');
  delete require.cache[key];
  return require('../lib/logger');
}

describe('logger – setVerbose / debug', () => {
  beforeEach(() => {
    // Clear the module cache before each test for isolation.
    const key = require.resolve('../lib/logger');
    delete require.cache[key];
  });

  test('debug() writes nothing to stderr when verbose is disabled (default)', () => {
    const log = freshLogger();

    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { chunks.push(chunk); return true; };
    try {
      log.debug('should not appear');
    } finally {
      process.stderr.write = original;
    }

    assert.equal(chunks.length, 0, 'debug() must be silent when verbose=false');
  });

  test('debug() writes to stderr when verbose is enabled', () => {
    const log = freshLogger();
    log.setVerbose(true);

    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      log.debug('hello verbose world');
    } finally {
      process.stderr.write = original;
    }

    assert.equal(chunks.length, 1, 'debug() should write exactly one chunk');
    assert.ok(chunks[0].includes('[DEBUG]'), 'Output should contain [DEBUG] prefix');
    assert.ok(chunks[0].includes('hello verbose world'), 'Output should contain the message');
  });

  test('setVerbose(false) disables debug output after it was enabled', () => {
    const log = freshLogger();
    log.setVerbose(true);
    log.setVerbose(false);

    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { chunks.push(chunk); return true; };
    try {
      log.debug('should be silenced');
    } finally {
      process.stderr.write = original;
    }

    assert.equal(chunks.length, 0, 'debug() must be silent after setVerbose(false)');
  });

  test('setVerbose() exports are present', () => {
    const log = freshLogger();
    assert.equal(typeof log.setVerbose, 'function', 'setVerbose should be exported');
    assert.equal(typeof log.debug, 'function', 'debug should be exported');
  });
});
