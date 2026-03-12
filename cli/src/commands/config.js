'use strict';

/**
 * `oclaw config` command.
 * View and set persistent configuration options.
 */

const { loadConfig, updateConfig, getConfigFilePath } = require('../lib/config');
const log = require('../lib/logger');

/**
 * Run the config command.
 * @param {Object} options
 * @param {boolean} [options.list]     - list current config
 * @param {boolean} [options.reset]    - reset to defaults
 * @param {boolean} [options.json]     - output result as JSON
 */
function runConfig(options = {}) {
  const shouldReset = options.reset;

  if (shouldReset) {
    const defaults = {
      cdnBase: require('../lib/config').DEFAULT_CDN_BASE,
      npmRegistry: require('../lib/config').DEFAULT_NPM_REGISTRY,
      installedVersion: null,
    };
    updateConfig(defaults);
    if (!options.json) log.success('Configuration reset to defaults.');
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
      npmRegistry: config.npmRegistry,
      installedVersion: config.installedVersion || null,
      configFile: getConfigFilePath(),
    }, null, 2));
    return;
  }

  console.log('');
  console.log('  \x1b[1moclaw Configuration\x1b[0m');
  console.log('  ' + '─'.repeat(40));
  console.log(`  Manifest   : ${config.cdnBase}/manifest.json`);
  console.log(`  Registry   : ${config.npmRegistry}`);
  console.log(`  Version    : ${config.installedVersion || '(unknown)'}`);
  console.log(`  Config file: ${getConfigFilePath()}`);
  console.log('');
}

module.exports = { runConfig };
