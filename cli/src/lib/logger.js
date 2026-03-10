'use strict';

/**
 * Simple console logger with color codes.
 * Avoids runtime dependencies like chalk.
 */

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function info(msg) {
  console.log(`${CYAN}ℹ${RESET}  ${msg}`);
}

function success(msg) {
  console.log(`${GREEN}✔${RESET}  ${msg}`);
}

function warn(msg) {
  console.warn(`${YELLOW}⚠${RESET}  ${msg}`);
}

function error(msg) {
  console.error(`${RED}✖${RESET}  ${msg}`);
}

function step(msg) {
  console.log(`${BOLD}→${RESET}  ${msg}`);
}

function dim(msg) {
  console.log(`${DIM}   ${msg}${RESET}`);
}

/**
 * Print a progress bar in-place.
 * @param {number} received - bytes received
 * @param {number} total - total bytes (0 if unknown)
 */
function progress(received, total) {
  if (total > 0) {
    const pct = Math.floor((received / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    const mb = (received / 1024 / 1024).toFixed(1);
    const totalMb = (total / 1024 / 1024).toFixed(1);
    process.stdout.write(`\r   ${CYAN}[${bar}]${RESET} ${pct}%  ${mb}/${totalMb} MB`);
  } else {
    const mb = (received / 1024 / 1024).toFixed(1);
    process.stdout.write(`\r   ${CYAN}Downloading...${RESET} ${mb} MB`);
  }
}

function progressEnd() {
  process.stdout.write('\n');
}

module.exports = { info, success, warn, error, step, dim, progress, progressEnd };
