'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), `oclaw-status-test-${Date.now()}-${process.pid}`);
const installDir = path.join(tmpDir, 'install');
const configDir = path.join(tmpDir, '.oclaw');

// Redirect config to temp dir
process.env.HOME = tmpDir;
if (process.platform === 'win32') {
  // On Windows, os.homedir() uses USERPROFILE (not HOME)
  process.env.USERPROFILE = tmpDir;
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
}

const { runStatus } = require('../commands/status');

/**
 * Capture console.log output while running fn(), then restore.
 * Returns an array of logged strings.
 */
async function captureLog(fn) {
  const output = [];
  const orig = console.log.bind(console);
  console.log = (...args) => output.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return output;
}

describe('runStatus – JSON output', () => {
  before(() => {
    fs.mkdirSync(installDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    // Write a version marker so the install dir is recognised as installed
    fs.writeFileSync(path.join(installDir, '.oclaw-version'), '1.2.3', 'utf-8');
    // Write config pointing to our temp installDir
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ installDir }),
      'utf-8'
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('outputs valid JSON when --json flag is set', async () => {
    const output = await captureLog(() => runStatus({ json: true }));

    assert.equal(output.length, 1, 'runStatus --json should call console.log exactly once');
    const parsed = JSON.parse(output[0]);

    assert.equal(typeof parsed.platform, 'string');
    assert.equal(typeof parsed.arch, 'string');
    assert.equal(typeof parsed.installDir, 'string');
    assert.equal(typeof parsed.installed, 'boolean');
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'installedVersion'));
    assert.equal(typeof parsed.cdnBase, 'string');
  });

  test('JSON output includes installedVersion when installed', async () => {
    const output = await captureLog(() => runStatus({ json: true }));
    const parsed = JSON.parse(output[0]);

    assert.equal(parsed.installed, true);
    assert.equal(parsed.installedVersion, '1.2.3');
  });

  test('JSON output does not include latestVersion when --check-updates is not set', async () => {
    const output = await captureLog(() => runStatus({ json: true }));
    const parsed = JSON.parse(output[0]);

    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'latestVersion'));
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'updateAvailable'));
  });

  test('JSON output includes latestVersion or latestVersionError with --check-updates', async () => {
    // getLatestVersion will fail (no real CDN in test), so latestVersionError is expected.
    // JSON mode uses console.log only (not process.stdout.write), so no capture needed.
    const output = await captureLog(() => runStatus({ json: true, checkUpdates: true }));

    const parsed = JSON.parse(output[0]);
    assert.ok(
      Object.prototype.hasOwnProperty.call(parsed, 'latestVersion') ||
      Object.prototype.hasOwnProperty.call(parsed, 'latestVersionError'),
      'Should have either latestVersion or latestVersionError'
    );
  });

  test('human-readable output is produced when --json is not set', async () => {
    // Without --check-updates, runStatus never calls process.stdout.write.
    const output = await captureLog(() => runStatus({}));

    const combined = output.join('\n');
    assert.ok(combined.includes('OpenClaw Installation Status'), 'Should include header');
  });
});


