'use strict';

/**
 * oclaw - OpenClaw installer/updater CLI for China mainland / restricted networks.
 *
 * Usage:
 *   oclaw install [--version <ver>] [--dir <path>] [--force]
 *   oclaw upgrade [--check]
 *   oclaw status  [--check-updates]
 *   oclaw config  [--cdn-url <url>] [--dir <path>] [--reset] [--list]
 */

const { program } = require('commander');
const pkg = require('../package.json');

program
  .name('oclaw')
  .description('OpenClaw installer and updater — downloads only from CDN, no npm/GitHub required')
  .version(pkg.version);

// ── install ────────────────────────────────────────────────────────────────────
program
  .command('install')
  .description('Download and install OpenClaw from CDN')
  .option('--version <version>', 'install a specific version (default: latest)')
  .option('--dir <path>', 'override installation directory')
  .option('--force', 'reinstall even if already at the same version', false)
  .action(async (opts) => {
    const { runInstall } = require('./commands/install');
    await runInstall(opts).catch(fatalError);
  });

// ── upgrade ────────────────────────────────────────────────────────────────────
program
  .command('upgrade')
  .description('Check for updates and upgrade OpenClaw if a newer version is available')
  .option('--check', 'only check for updates, do not upgrade', false)
  .action(async (opts) => {
    const { runUpgrade } = require('./commands/upgrade');
    await runUpgrade({ checkOnly: opts.check }).catch(fatalError);
  });

// ── status ─────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show current installation status and version')
  .option('--check-updates', 'also check CDN for the latest available version', false)
  .action(async (opts) => {
    const { runStatus } = require('./commands/status');
    await runStatus({ checkUpdates: opts.checkUpdates }).catch(fatalError);
  });

// ── config ─────────────────────────────────────────────────────────────────────
program
  .command('config')
  .description('View or update oclaw configuration')
  .option('--cdn-url <url>', 'set the CDN base URL')
  .option('--dir <path>', 'set the installation directory')
  .option('--reset', 'reset configuration to defaults', false)
  .option('--list', 'list current configuration (default action)', false)
  .action((opts) => {
    const { runConfig } = require('./commands/config');
    runConfig(opts);
  });

// ── error handling ─────────────────────────────────────────────────────────────
function fatalError(err) {
  console.error(`\x1b[31m✖  Fatal error: ${err.message}\x1b[0m`);
  process.exit(1);
}

program.parse(process.argv);

// If no sub-command provided, show help
if (process.argv.length <= 2) {
  program.help();
}
