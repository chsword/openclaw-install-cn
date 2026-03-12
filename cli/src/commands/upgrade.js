'use strict';

/**
 * `oclaw upgrade` command.
 * Checks for a newer version from manifest.json and upgrades with pnpm if needed.
 */

const { loadConfig } = require('../lib/config');
const registry = require('../lib/registry');
const runtime = require('../lib/runtime');
const { runInstall } = require('./install');
const log = require('../lib/logger');

/**
 * Run the upgrade command.
 * @param {Object} options
 * @param {boolean} [options.checkOnly] - only check, don't upgrade
 * @param {boolean} [options.json]      - output result as JSON
 */
async function runUpgrade(options = {}) {
  const config = loadConfig();
  const environment = await runtime.inspectEnvironment();
  const installedVersion = environment.openclaw.version || config.installedVersion;

  if (!environment.node.installed || !environment.node.supported || !environment.pnpm.installed) {
    if (options.json) {
      console.log(JSON.stringify({
        error: 'Node.js >= 18 and pnpm are required before upgrading OpenClaw.',
      }, null, 2));
    } else {
      if (!environment.node.installed) {
        log.warn('Node.js is not installed.');
      } else if (!environment.node.supported) {
        log.warn(`Node.js ${environment.node.version} is too old.`);
      }
      if (!environment.pnpm.installed) {
        log.warn('pnpm is not installed.');
        log.dim('Install it with: npm install -g pnpm');
      }
    }
    process.exit(1);
  }

  if (!environment.openclaw.installed && !installedVersion) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'OpenClaw does not appear to be installed yet.' }, null, 2));
    } else {
      log.warn('OpenClaw does not appear to be installed yet.');
      log.dim('Run `oclaw install` to install it first.');
    }
    process.exit(1);
  }

  if (!options.json) log.step('Checking for updates...');
  let latestVersion;
  try {
    latestVersion = await registry.getLatestVersion(config.cdnBase);
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Failed to check for updates: ${err.message}` }, null, 2));
    } else {
      log.error(`Failed to check for updates: ${err.message}`);
    }
    process.exit(1);
  }

  const updateAvailable = runtime.compareVersions(latestVersion, installedVersion) > 0;

  if (options.json && options.checkOnly) {
    console.log(JSON.stringify({
      installedVersion: installedVersion || null,
      latestVersion,
      updateAvailable,
    }, null, 2));
    return;
  }

  if (!updateAvailable) {
    if (options.json) {
      console.log(JSON.stringify({
        installedVersion: installedVersion || null,
        latestVersion,
        updateAvailable: false,
        upgraded: false,
      }, null, 2));
      return;
    }
    log.success(`OpenClaw is up to date (${installedVersion}).`);
    return;
  }

  if (!options.json) {
    if (installedVersion) {
      log.info(`Upgrade available: ${installedVersion} → ${latestVersion}`);
    } else {
      log.info(`Latest version: ${latestVersion}`);
    }
  }

  if (options.checkOnly) {
    log.dim('Run `oclaw upgrade` without --check to apply the upgrade.');
    return;
  }

  await runInstall({ version: latestVersion, force: true });

  if (options.json) {
    console.log(JSON.stringify({
      installedVersion: installedVersion || null,
      latestVersion,
      updateAvailable: true,
      upgraded: true,
    }, null, 2));
  }
}

module.exports = { runUpgrade, compareSemver: runtime.compareVersions };
