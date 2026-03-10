'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point config to a temp dir to avoid polluting real config
const tmpDir = path.join(os.tmpdir(), `oclaw-test-${Date.now()}`);

// Override module config paths by setting env before requiring
process.env.HOME = tmpDir;
if (process.platform === 'win32') {
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
}

const { loadConfig, saveConfig, updateConfig, DEFAULT_CDN_BASE, getConfigFilePath } = require('../lib/config');

describe('config', () => {
  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loadConfig returns defaults when no config file exists', () => {
    const cfg = loadConfig();
    assert.equal(cfg.cdnBase, DEFAULT_CDN_BASE);
    assert.ok(typeof cfg.installDir === 'string');
    assert.equal(cfg.installedVersion, null);
  });

  test('saveConfig and loadConfig round-trip', () => {
    const cfg = loadConfig();
    cfg.installDir = path.join(tmpDir, 'my-install-dir');
    saveConfig(cfg);
    const loaded = loadConfig();
    assert.equal(loaded.installDir, path.join(tmpDir, 'my-install-dir'));
    // cdnBase is always the hardcoded constant, never loaded from file
    assert.equal(loaded.cdnBase, DEFAULT_CDN_BASE);
  });

  test('saveConfig does not persist cdnBase to disk', () => {
    const cfg = loadConfig();
    saveConfig(cfg);
    const raw = JSON.parse(fs.readFileSync(getConfigFilePath(), 'utf-8'));
    assert.ok(!Object.prototype.hasOwnProperty.call(raw, 'cdnBase'), 'cdnBase must not be saved to disk');
  });

  test('updateConfig merges partial updates', () => {
    const updated = updateConfig({ installedVersion: '1.0.0' });
    assert.equal(updated.installedVersion, '1.0.0');
    // cdnBase is always the hardcoded constant regardless of stored config
    assert.equal(updated.cdnBase, DEFAULT_CDN_BASE);
  });
});
