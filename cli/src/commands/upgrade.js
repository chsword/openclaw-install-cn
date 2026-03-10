'use strict';

/**
 * `oclaw upgrade` command.
 * Checks for a newer version on CDN and upgrades if available.
 */

const { loadConfig } = require('../lib/config');
const { getLatestVersion, getVersionInfo } = require('../lib/registry');
const { readVersionMarker, isInstalled } = require('../lib/installer');
const { runInstall } = require('./install');
const log = require('../lib/logger');

/**
 * Compare two semver strings. Returns:
 *  1 if a > b
 * -1 if a < b
 *  0 if equal
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Run the upgrade command.
 * @param {Object} options
 * @param {boolean} [options.checkOnly] - only check, don't upgrade
 */
async function runUpgrade(options = {}) {
  const config = loadConfig();
  const cdnBase = config.cdnBase;
  const installDir = config.installDir;

  // Determine current installed version
  const installedVersion = readVersionMarker(installDir) || config.installedVersion;

  if (!isInstalled(installDir) && !installedVersion) {
    log.warn('OpenClaw does not appear to be installed yet.');
    log.dim('Run `oclaw install` to install it first.');
    process.exit(1);
  }

  log.step('Checking for updates...');
  let latestVersion;
  try {
    latestVersion = await getLatestVersion(cdnBase);
  } catch (err) {
    log.error(`Failed to check for updates: ${err.message}`);
    process.exit(1);
  }

  if (installedVersion && compareSemver(latestVersion, installedVersion) <= 0) {
    log.success(`OpenClaw is up to date (${installedVersion}).`);
    return;
  }

  if (installedVersion) {
    log.info(`Upgrade available: ${installedVersion} → ${latestVersion}`);
  } else {
    log.info(`Latest version: ${latestVersion}`);
  }

  if (options.checkOnly) {
    log.dim('Run `oclaw upgrade` without --check to apply the upgrade.');
    return;
  }

  await runInstall({ version: latestVersion, force: true });
}

module.exports = { runUpgrade, compareSemver };
