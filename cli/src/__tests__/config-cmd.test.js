'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), `oclaw-configcmd-test-${Date.now()}-${process.pid}`);

// Redirect config and home to temp dir
process.env.HOME = tmpDir;
if (process.platform === 'win32') {
  // On Windows, os.homedir() uses USERPROFILE (not HOME)
  process.env.USERPROFILE = tmpDir;
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
}

const { runConfig } = require('../commands/config');

/**
 * Capture console.log output while running fn(), then restore.
 * Returns an array of logged strings.
 */
function captureLog(fn) {
  const output = [];
  const orig = console.log.bind(console);
  console.log = (...args) => output.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return output;
}

describe('runConfig – JSON output', () => {
  before(() => {
    fs.mkdirSync(path.join(tmpDir, '.oclaw'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('outputs valid JSON when --json flag is set', () => {
    const output = captureLog(() => runConfig({ json: true }));

    assert.equal(output.length, 1, 'runConfig --json should call console.log exactly once');
    const parsed = JSON.parse(output[0]);

    assert.equal(typeof parsed.cdnBase, 'string');
    assert.equal(typeof parsed.installDir, 'string');
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'installedVersion'));
    assert.equal(typeof parsed.configFile, 'string');
  });

  test('JSON output has null installedVersion when not installed', () => {
    const output = captureLog(() => runConfig({ json: true }));
    const parsed = JSON.parse(output[0]);

    assert.equal(parsed.installedVersion, null);
  });

  test('human-readable output is produced when --json is not set', () => {
    const output = captureLog(() => runConfig({}));
    const combined = output.join('\n');

    assert.ok(combined.includes('oclaw Configuration'), 'Should include header');
  });

  test('--json suppresses success log on --reset', () => {
    // Capture both console.log and console.warn to detect any plain-text success message
    const logged = [];
    const warned = [];
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console.warn);
    console.log = (...args) => logged.push(args.join(' '));
    console.warn = (...args) => warned.push(args.join(' '));
    try {
      runConfig({ reset: true, json: true });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }

    // Exactly one console.log call (the JSON), no extra plain-text lines
    assert.equal(logged.length, 1);
    const parsed = JSON.parse(logged[0]);
    assert.equal(typeof parsed.cdnBase, 'string');
  });
});
