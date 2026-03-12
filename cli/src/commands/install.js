'use strict';

/**
 * `oclaw install` command.
 * Verifies the runtime environment and installs OpenClaw via pnpm.
 */

const { loadConfig, updateConfig } = require('../lib/config');
const registry = require('../lib/registry');
const runtime = require('../lib/runtime');
const log = require('../lib/logger');

function exitForMissingPrerequisite(environment) {
  if (!environment.node.installed) {
    log.error('Node.js is not installed.');
    log.dim('Please install Node.js 18 or newer first.');
    process.exit(1);
  }

  if (!environment.node.supported) {
    log.error(`Node.js ${environment.node.version} is too old.`);
    log.dim('Please upgrade Node.js to version 18 or newer.');
    process.exit(1);
  }

  if (!environment.pnpm.installed) {
    log.error('pnpm is not installed.');
    log.dim('Install it with: npm install -g pnpm');
    process.exit(1);
  }
}

async function runInstall(options = {}) {
  const config = loadConfig();

  log.step('Checking local environment...');
  const environment = await runtime.inspectEnvironment();
  exitForMissingPrerequisite(environment);

  log.success(`Node.js ${environment.node.version} detected.`);
  log.success(`pnpm ${environment.pnpm.version} detected.`);

  let latestVersion;
  try {
    latestVersion = await registry.getLatestVersion(config.cdnBase);
  } catch (err) {
    log.error(`Failed to fetch latest OpenClaw version: ${err.message}`);
    process.exit(1);
  }

  if (environment.openclaw.installed) {
    log.info(`Detected installed OpenClaw: ${environment.openclaw.version}`);
  } else {
    log.info('OpenClaw is not installed yet.');
  }
  log.info(`Latest version from manifest: ${latestVersion}`);

  if (!options.force && environment.openclaw.installed) {
    const comparison = runtime.compareVersions(environment.openclaw.version, latestVersion);
    if (comparison >= 0) {
      updateConfig({ installedVersion: environment.openclaw.version });
      log.success(`OpenClaw ${environment.openclaw.version} is already up to date.`);
      log.dim('Use --force to reinstall from pnpm.');
      return;
    }
  }

  log.step('Installing OpenClaw via pnpm...');
  log.dim(runtime.getInstallCommandString());

  try {
    await runtime.installOpenclaw({
      onStdout: (text) => {
        const message = text.trim();
        if (message) {
          log.debug(message);
        }
      },
      onStderr: (text) => {
        const message = text.trim();
        if (message) {
          log.debug(message);
        }
      },
    });
  } catch (err) {
    log.error(`pnpm install failed: ${err.message}`);
    process.exit(1);
  }

  const refreshed = await runtime.inspectEnvironment();
  if (!refreshed.openclaw.installed || !refreshed.openclaw.version) {
    log.error('OpenClaw installation finished, but the openclaw command is still unavailable.');
    log.dim('Please ensure pnpm global bin is on PATH, then run openclaw --version.');
    process.exit(1);
  }

  updateConfig({ installedVersion: refreshed.openclaw.version });
  log.success(`OpenClaw ${refreshed.openclaw.version} installed successfully.`);
}

module.exports = { runInstall, exitForMissingPrerequisite };
