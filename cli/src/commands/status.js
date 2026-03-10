'use strict';

/**
 * `oclaw status` command.
 * Shows the current installation status and version info.
 */

const fs = require('fs');
const { loadConfig } = require('../lib/config');
const { getLatestVersion } = require('../lib/registry');
const { readVersionMarker, isInstalled } = require('../lib/installer');
const { getPlatformLabel, getArch } = require('../lib/platform');
const { compareSemver } = require('./upgrade');
const log = require('../lib/logger');

/**
 * Run the status command.
 * @param {Object} options
 * @param {boolean} [options.checkUpdates] - also check CDN for latest version
 * @param {boolean} [options.json]         - output result as JSON
 */
async function runStatus(options = {}) {
  const config = loadConfig();
  const installDir = config.installDir;

  const installed = isInstalled(installDir);
  const installedVersion = installed ? readVersionMarker(installDir) : config.installedVersion;

  if (options.json) {
    const result = {
      platform: getPlatformLabel(),
      arch: getArch(),
      installDir,
      installed,
      installedVersion: installedVersion || null,
      cdnBase: config.cdnBase,
    };

    if (options.checkUpdates) {
      try {
        const latest = await getLatestVersion(config.cdnBase);
        result.latestVersion = latest;
        result.updateAvailable = !!installedVersion && compareSemver(latest, installedVersion) > 0;
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
  console.log(`  Install Dir: ${installDir}`);

  if (installed && installedVersion) {
    console.log(`  Installed  : \x1b[32m${installedVersion}\x1b[0m`);
  } else if (!installed) {
    console.log(`  Installed  : \x1b[33mNot installed\x1b[0m`);
  } else {
    console.log(`  Installed  : \x1b[33mUnknown version\x1b[0m`);
  }

  console.log(`  CDN Base   : ${config.cdnBase}`);

  if (options.checkUpdates) {
    process.stdout.write('  Latest     : checking...');
    try {
      const latest = await getLatestVersion(config.cdnBase);
      process.stdout.write(`\r  Latest     : \x1b[36m${latest}\x1b[0m\n`);
      if (installedVersion && installedVersion !== latest) {
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
