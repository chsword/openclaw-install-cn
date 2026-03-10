'use strict';

/**
 * `oclaw config` command.
 * View and set persistent configuration options.
 */

const { loadConfig, updateConfig, getConfigFilePath } = require('../lib/config');
const { getDefaultInstallDir } = require('../lib/platform');
const log = require('../lib/logger');

/**
 * Run the config command.
 * @param {Object} options
 * @param {string} [options.dir]       - set install directory
 * @param {boolean} [options.list]     - list current config
 * @param {boolean} [options.reset]    - reset to defaults
 * @param {boolean} [options.json]     - output result as JSON
 */
function runConfig(options = {}) {
  const hasUpdate = options.dir;
  const shouldReset = options.reset;

  if (shouldReset) {
    const defaults = {
      cdnBase: require('../lib/config').DEFAULT_CDN_BASE,
      installDir: getDefaultInstallDir(),
      installedVersion: null,
    };
    updateConfig(defaults);
    if (!options.json) log.success('Configuration reset to defaults.');
    printConfig(loadConfig(), options.json);
    return;
  }

  if (hasUpdate) {
    const updates = {};
    if (options.dir) updates.installDir = options.dir;
    updateConfig(updates);
    if (!options.json) log.success('Configuration updated.');
    printConfig(loadConfig(), options.json);
    return;
  }

  // Default: just list config
  printConfig(loadConfig(), options.json);
}

function printConfig(config, asJson) {
  if (asJson) {
    console.log(JSON.stringify({
      cdnBase: config.cdnBase,
      installDir: config.installDir,
      installedVersion: config.installedVersion || null,
      configFile: getConfigFilePath(),
    }, null, 2));
    return;
  }

  console.log('');
  console.log('  \x1b[1moclaw Configuration\x1b[0m');
  console.log('  ' + '─'.repeat(40));
  console.log(`  CDN URL    : ${config.cdnBase}`);
  console.log(`  Install Dir: ${config.installDir}`);
  console.log(`  Version    : ${config.installedVersion || '(not installed)'}`);
  console.log(`  Config file: ${getConfigFilePath()}`);
  console.log('');
}

module.exports = { runConfig };
