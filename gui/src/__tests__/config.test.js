'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point config to a temp dir to avoid polluting real config
const tmpDir = path.join(os.tmpdir(), `oclaw-gui-config-test-${Date.now()}`);

// Override module config paths by setting env before requiring
process.env.HOME = tmpDir;
if (process.platform === 'win32') {
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
  process.env.USERPROFILE = tmpDir;
}

const {
  loadConfig,
  saveConfig,
  updateConfig,
  DEFAULT_CDN_BASE,
  DEFAULT_NPM_REGISTRY,
  getConfigFilePath,
} = require('../lib/config');

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
    assert.equal(cfg.npmRegistry, DEFAULT_NPM_REGISTRY);
    assert.equal(cfg.installedVersion, null);
  });

  test('saveConfig and loadConfig round-trip', () => {
    const cfg = loadConfig();
    cfg.installedVersion = '2.0.0';
    saveConfig(cfg);
    const loaded = loadConfig();
    assert.equal(loaded.installedVersion, '2.0.0');
    // cdnBase is always the hardcoded constant, never loaded from file
    assert.equal(loaded.cdnBase, DEFAULT_CDN_BASE);
    assert.equal(loaded.npmRegistry, DEFAULT_NPM_REGISTRY);
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

  test('DEFAULT_CDN_BASE is a non-empty string', () => {
    assert.ok(typeof DEFAULT_CDN_BASE === 'string' && DEFAULT_CDN_BASE.length > 0);
  });

  test('getConfigFilePath returns a string path', () => {
    const p = getConfigFilePath();
    assert.ok(typeof p === 'string' && p.length > 0);
  });
});
