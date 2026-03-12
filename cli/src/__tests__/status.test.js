'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), `oclaw-status-test-${Date.now()}-${process.pid}`);
const configDir = path.join(tmpDir, '.oclaw');

process.env.HOME = tmpDir;
if (process.platform === 'win32') {
  process.env.USERPROFILE = tmpDir;
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
}

const runtime = require('../lib/runtime');
const registry = require('../lib/registry');
const { runStatus } = require('../commands/status');

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
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ installedVersion: '1.2.3' }),
      'utf-8'
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('outputs valid JSON when --json flag is set', async () => {
    const originalInspect = runtime.inspectEnvironment;
    runtime.inspectEnvironment = async () => ({
      node: { installed: true, version: '20.0.0', supported: true },
      pnpm: { installed: true, version: '9.0.0' },
      openclaw: { installed: true, version: '1.2.3' },
    });

    const output = await captureLog(() => runStatus({ json: true }));
    runtime.inspectEnvironment = originalInspect;

    assert.equal(output.length, 1, 'runStatus --json should call console.log exactly once');
    const parsed = JSON.parse(output[0]);

    assert.equal(typeof parsed.platform, 'string');
    assert.equal(typeof parsed.arch, 'string');
    assert.equal(typeof parsed.installed, 'boolean');
    assert.equal(typeof parsed.cdnBase, 'string');
    assert.equal(typeof parsed.npmRegistry, 'string');
    assert.equal(parsed.nodeVersion, '20.0.0');
    assert.equal(parsed.pnpmVersion, '9.0.0');
  });

  test('JSON output includes installedVersion when installed', async () => {
    const originalInspect = runtime.inspectEnvironment;
    runtime.inspectEnvironment = async () => ({
      node: { installed: true, version: '20.0.0', supported: true },
      pnpm: { installed: true, version: '9.0.0' },
      openclaw: { installed: true, version: '1.2.3' },
    });

    const output = await captureLog(() => runStatus({ json: true }));
    runtime.inspectEnvironment = originalInspect;
    const parsed = JSON.parse(output[0]);

    assert.equal(parsed.installed, true);
    assert.equal(parsed.installedVersion, '1.2.3');
  });

  test('JSON output does not include latestVersion when --check-updates is not set', async () => {
    const originalInspect = runtime.inspectEnvironment;
    runtime.inspectEnvironment = async () => ({
      node: { installed: true, version: '20.0.0', supported: true },
      pnpm: { installed: true, version: '9.0.0' },
      openclaw: { installed: true, version: '1.2.3' },
    });

    const output = await captureLog(() => runStatus({ json: true }));
    runtime.inspectEnvironment = originalInspect;
    const parsed = JSON.parse(output[0]);

    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'latestVersion'));
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'updateAvailable'));
  });

  test('JSON output includes latestVersion with --check-updates', async () => {
    const originalInspect = runtime.inspectEnvironment;
    const originalLatest = registry.getLatestVersion;
    runtime.inspectEnvironment = async () => ({
      node: { installed: true, version: '20.0.0', supported: true },
      pnpm: { installed: true, version: '9.0.0' },
      openclaw: { installed: true, version: '1.2.3' },
    });
    registry.getLatestVersion = async () => '1.2.4';

    const output = await captureLog(() => runStatus({ json: true, checkUpdates: true }));

    runtime.inspectEnvironment = originalInspect;
    registry.getLatestVersion = originalLatest;

    const parsed = JSON.parse(output[0]);
    assert.equal(parsed.latestVersion, '1.2.4');
    assert.equal(parsed.updateAvailable, true);
  });

  test('human-readable output is produced when --json is not set', async () => {
    const originalInspect = runtime.inspectEnvironment;
    runtime.inspectEnvironment = async () => ({
      node: { installed: true, version: '20.0.0', supported: true },
      pnpm: { installed: true, version: '9.0.0' },
      openclaw: { installed: true, version: '1.2.3' },
    });

    const output = await captureLog(() => runStatus({}));
    runtime.inspectEnvironment = originalInspect;

    const combined = output.join('\n');
    assert.ok(combined.includes('OpenClaw Installation Status'), 'Should include header');
  });
});


