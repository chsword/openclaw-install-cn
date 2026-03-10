'use strict';

/**
 * Configuration management for oclaw CLI.
 * Config is stored as JSON in the user's home directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultInstallDir } = require('./platform');

const CONFIG_DIR = path.join(os.homedir(), '.oclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CDN_BASE = 'https://oclaw.chatu.plus';

/**
 * @typedef {Object} OclawConfig
 * @property {string} cdnBase   - CDN base URL (always the hardcoded constant; not user-configurable)
 * @property {string} installDir - OpenClaw installation directory
 * @property {string|null} installedVersion - Currently installed version
 */

/** @returns {OclawConfig} */
function getDefaults() {
  return {
    // cdnBase is always the hardcoded constant. OCLAW_CDN env var is a test-only override.
    cdnBase: process.env.OCLAW_CDN || DEFAULT_CDN_BASE,
    installDir: getDefaultInstallDir(),
    installedVersion: null,
  };
}

/**
 * Load config from disk, merging with defaults.
 * cdnBase is always the hardcoded constant and is never read from the config file.
 * @returns {OclawConfig}
 */
function loadConfig() {
  const defaults = getDefaults();
  if (!fs.existsSync(CONFIG_FILE)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const stored = JSON.parse(raw);
    // cdnBase is not user-configurable; always use the hardcoded default.
    const { cdnBase: _cdnBase, ...storedWithoutCdn } = stored;
    return Object.assign({}, defaults, storedWithoutCdn);
  } catch {
    return defaults;
  }
}

/**
 * Save config to disk.
 * cdnBase is always the hardcoded constant and is never written to the config file.
 * @param {OclawConfig} config
 */
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  // Strip cdnBase — it's always the hardcoded constant, never persisted.
  const { cdnBase: _cdnBase, ...configToSave } = config;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf-8');
}

/**
 * Update one or more config keys.
 * @param {Partial<OclawConfig>} updates
 * @returns {OclawConfig} updated config
 */
function updateConfig(updates) {
  const config = loadConfig();
  const updated = Object.assign({}, config, updates);
  saveConfig(updated);
  return updated;
}

/**
 * Return the path to the config file.
 * @returns {string}
 */
function getConfigFilePath() {
  return CONFIG_FILE;
}

module.exports = {
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigFilePath,
  DEFAULT_CDN_BASE,
};
