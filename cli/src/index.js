'use strict';

/**
 * oclaw <command> [options]
 *
 * Usage:
 *   oclaw install    [--force]
 *   oclaw upgrade    [--check] [--json]
 *   oclaw status     [--check-updates] [--json]
 *   oclaw config     [--reset] [--list] [--json]
 *   oclaw version
 *   oclaw completion [--shell bash|zsh|fish]
 */

const { program } = require('commander');
const pkg = require('../package.json');
const log = require('./lib/logger');

program
  .name('oclaw')
  .description('OpenClaw installer and updater for pnpm + npmmirror environments')
  .version(pkg.version, '-v, --version', 'display the oclaw CLI version')
  .option('--verbose', 'enable verbose/debug output', false);

// Enable verbose mode before any sub-command action runs.
program.hook('preAction', () => {
  if (program.opts().verbose) {
    log.setVerbose(true);
  }
});

// ── install ────────────────────────────────────────────────────────────────────
program
  .command('install')
  .description('Verify prerequisites and install OpenClaw via pnpm')
  .option('--force', 'reinstall even if already at the latest version', false)
  .action(async (opts) => {
    const { runInstall } = require('./commands/install');
    await runInstall(opts).catch(fatalError);
  });

// ── upgrade ────────────────────────────────────────────────────────────────────
program
  .command('upgrade')
  .description('Check for updates and upgrade OpenClaw if a newer version is available')
  .option('--check', 'only check for updates, do not upgrade', false)
  .option('--json', 'output result as JSON', false)
  .action(async (opts) => {
    const { runUpgrade } = require('./commands/upgrade');
    await runUpgrade({ checkOnly: opts.check, json: opts.json }).catch(fatalError);
  });

// ── status ─────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show current installation status and version')
  .option('--check-updates', 'also check manifest.json for the latest available version', false)
  .option('--json', 'output result as JSON', false)
  .action(async (opts) => {
    const { runStatus } = require('./commands/status');
    await runStatus({ checkUpdates: opts.checkUpdates, json: opts.json }).catch(fatalError);
  });

// ── config ─────────────────────────────────────────────────────────────────────
program
  .command('config')
  .description('View oclaw configuration')
  .option('--reset', 'reset configuration to defaults', false)
  .option('--list', 'list current configuration (default action)', false)
  .option('--json', 'output result as JSON', false)
  .action((opts) => {
    const { runConfig } = require('./commands/config');
    runConfig(opts);
  });

// ── version ────────────────────────────────────────────────────────────────────
program
  .command('version')
  .description('Display the oclaw CLI version')
  .action(() => {
    console.log(pkg.version);
  });

// ── completion ─────────────────────────────────────────────────────────────────
program
  .command('completion')
  .description('Generate shell completion script (bash, zsh, or fish)')
  .option('--shell <shell>', 'target shell: bash, zsh, or fish (default: bash)')
  .action((opts) => {
    const { runCompletion } = require('./commands/completion');
    runCompletion(opts);
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
