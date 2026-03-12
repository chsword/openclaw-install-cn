'use strict';

/**
 * `oclaw status` command.
 * Shows the current installation status and version info.
 */

const fs = require('fs');
const { loadConfig } = require('../lib/config');
const registry = require('../lib/registry');
const { getPlatformLabel, getArch } = require('../lib/platform');
const runtime = require('../lib/runtime');
const log = require('../lib/logger');

/**
 * Run the status command.
 * @param {Object} options
 * @param {boolean} [options.checkUpdates] - also check CDN for latest version
 * @param {boolean} [options.json]         - output result as JSON
 */
async function runStatus(options = {}) {
  const config = loadConfig();
  const environment = await runtime.inspectEnvironment();
  const installed = environment.openclaw.installed;
  const installedVersion = environment.openclaw.version || config.installedVersion;

  if (options.json) {
    const result = {
      platform: getPlatformLabel(),
      arch: getArch(),
      installed,
      installedVersion: installedVersion || null,
      cdnBase: config.cdnBase,
      npmRegistry: config.npmRegistry,
      nodeInstalled: environment.node.installed,
      nodeVersion: environment.node.version,
      nodeSupported: environment.node.supported,
      pnpmInstalled: environment.pnpm.installed,
      pnpmVersion: environment.pnpm.version,
    };

    if (options.checkUpdates) {
      try {
        const latest = await registry.getLatestVersion(config.cdnBase);
        result.latestVersion = latest;
        result.updateAvailable = !!installedVersion && runtime.compareVersions(latest, installedVersion) > 0;
      } catch (err) {
        result.latestVersion = null;
        result.latestVersionError = err.message;
      }
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log('  \x1b[1mOpenClaw Installation Status\x1b[0m');
  console.log('  ' + '─'.repeat(40));

  console.log(`  Platform   : ${getPlatformLabel()} (${getArch()})`);
  console.log(`  Node.js    : ${environment.node.installed ? environment.node.version : 'Not installed'}`);
  console.log(`  pnpm       : ${environment.pnpm.installed ? environment.pnpm.version : 'Not installed'}`);

  if (installed && installedVersion) {
    console.log(`  Installed  : \x1b[32m${installedVersion}\x1b[0m`);
  } else if (!installed) {
    console.log(`  Installed  : \x1b[33mNot installed\x1b[0m`);
  } else {
    console.log(`  Installed  : \x1b[33mUnknown version\x1b[0m`);
  }

  console.log(`  Registry   : ${config.npmRegistry}`);
  console.log(`  Manifest   : ${config.cdnBase}/manifest.json`);

  if (options.checkUpdates) {
    process.stdout.write('  Latest     : checking...');
    try {
      const latest = await registry.getLatestVersion(config.cdnBase);
      process.stdout.write(`\r  Latest     : \x1b[36m${latest}\x1b[0m\n`);
      if (installedVersion && runtime.compareVersions(latest, installedVersion) > 0) {
        console.log(`\n  \x1b[33m⚠  Update available: ${installedVersion} → ${latest}\x1b[0m`);
        console.log('  Run \x1b[1moclaw upgrade\x1b[0m to update.');
      } else if (installedVersion === latest) {
        console.log('\n  \x1b[32m✔  You are up to date.\x1b[0m');
      }
    } catch (err) {
      process.stdout.write(`\r  Latest     : \x1b[31munable to check (${err.message})\x1b[0m\n`);
    }
  }

  console.log('');
}

module.exports = { runStatus };
