'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../lib/logger');

describe('logger', () => {
  test('exports required functions', () => {
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.success, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.step, 'function');
    assert.equal(typeof logger.dim, 'function');
    assert.equal(typeof logger.progress, 'function');
    assert.equal(typeof logger.progressEnd, 'function');
  });

  test('info() writes to stdout', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.info('test info message');
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test info message'), 'info output should contain the message');
  });

  test('success() writes to stdout', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.success('test success message');
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test success message'), 'success output should contain the message');
  });

  test('warn() writes to stderr', () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.warn('test warn message');
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test warn message'), 'warn output should contain the message');
  });

  test('error() writes to stderr', () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.error('test error message');
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test error message'), 'error output should contain the message');
  });

  test('step() writes to stdout', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.step('test step message');
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test step message'), 'step output should contain the message');
  });

  test('dim() writes to stdout', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.dim('test dim message');
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('test dim message'), 'dim output should contain the message');
  });

  test('progress() writes to stdout with known total', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.progress(512 * 1024, 1024 * 1024);
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.length > 0, 'progress should write output');
    assert.ok(output.includes('50'), 'progress should show 50% for half-complete download');
  });

  test('progress() writes to stdout with unknown total', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.progress(512 * 1024, 0);
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.length > 0, 'progress should write output even without known total');
  });

  test('progressEnd() writes a newline to stdout', () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return true; };
    try {
      logger.progressEnd();
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('\n'), 'progressEnd should write a newline');
  });
});
