'use strict';

/**
 * Runtime execution helpers: process spawning, binary detection, version
 * parsing, and install command generation.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Default pnpm registry used for all install operations. */
const PNPM_REGISTRY = 'https://registry.npmmirror.com';

/** pnpm package specifier used when installing openclaw. */
const OPENCLAW_PACKAGE_SPEC = 'openclaw@latest';

/**
 * Return the ordered list of executable names to try for the given command.
 * On Windows, `.cmd` and `.exe` variants are prepended as appropriate.
 * @param {string} command - Base command name (e.g. `'node'`, `'pnpm'`).
 * @returns {string[]}
 */
function getExecutableCandidates(command) {
  if (process.platform !== 'win32') {
    return [command];
  }

  if (command.endsWith('.cmd') || command.endsWith('.exe')) {
    return [command];
  }

  if (command === 'node' || command === 'winget') {
    return [`${command}.exe`, command];
  }

  return [`${command}.cmd`, `${command}.exe`, command];
}

/**
 * Wrap a value in double-quotes, escaping any embedded double-quotes, for use
 * as a cmd.exe argument.
 * @param {string} value
 * @returns {string}
 */
function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Wrap a value in double-quotes only when it contains characters that require
 * quoting under cmd.exe (spaces, quotes, shell meta-characters).
 * @param {string} value
 * @returns {string}
 */
function formatForCmd(value) {
  const text = String(value);
  return /[\s"&|<>^()]/.test(text) ? quoteForCmd(text) : text;
}

/**
 * Spawn an executable with the given arguments and return a Promise that
 * resolves with `{ stdout, stderr, code }` on exit code 0, or rejects with
 * an enriched Error otherwise.
 *
 * `.cmd` / `.bat` executables on Windows are invoked via `cmd.exe /s /c`
 * (shell: true) so that the shim forwarding works correctly.
 *
 * @param {string} executable - Full path or command name to execute.
 * @param {string[]} [args]   - Arguments to pass to the process.
 * @param {object}  [options] - Options forwarded to `child_process.spawn`,
 *   plus optional `onStdout` / `onStderr` streaming callbacks.
 * @param {(chunk: string) => void} [options.onStdout]
 * @param {(chunk: string) => void} [options.onStderr]
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function spawnOnce(executable, args = [], options = {}) {
  const useCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  return new Promise((resolve, reject) => {
    const spawnCommand = useCmdShim
      ? `${formatForCmd(executable)} ${args.map(formatForCmd).join(' ')}`.trim()
      : executable;
    const spawnArgs = useCmdShim ? [] : args;

    const child = spawn(spawnCommand, spawnArgs, {
      shell: useCmdShim,
      windowsHide: true,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (typeof options.onStdout === 'function') {
        options.onStdout(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (typeof options.onStderr === 'function') {
        options.onStderr(text);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }

      const error = new Error(stderr.trim() || stdout.trim() || `${executable} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

/**
 * Run `command` with `args`, trying each executable candidate in turn.
 * On ENOENT the next candidate is tried; any other error is re-thrown
 * immediately.
 * @param {string}   command         - Base command name.
 * @param {string[]} [args]          - Arguments to pass.
 * @param {object}   [options]       - Options forwarded to `spawnOnce`.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function runCommand(command, args = [], options = {}) {
  const candidates = getExecutableCandidates(command);
  let lastError = null;

  for (const executable of candidates) {
    try {
      return await spawnOnce(executable, args, options);
    } catch (error) {
      lastError = error;
      if (error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(`${command} not found`);
}

/**
 * Extract the first semver-like version string from command output.
 * Returns the raw first word when no `x.y.z` pattern is found, or `null`
 * for empty input.
 * @param {string|undefined} output
 * @returns {string|null}
 */
function parseVersion(output) {
  const text = String(output || '').trim();
  if (!text) {
    return null;
  }

  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : text.split(/\s+/)[0];
}

/**
 * Parse the openclaw package version from the JSON output of
 * `pnpm ls -g openclaw --json --depth 0`.
 * @param {string|undefined} output - Raw stdout from `pnpm ls`.
 * @returns {string|null}
 */
function parseOpenclawVersionFromPnpmList(output) {
  const text = String(output || '').trim();
  if (!text) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const deps = item.dependencies;
    if (!deps || typeof deps !== 'object') continue;
    const openclaw = deps.openclaw;
    if (openclaw && typeof openclaw === 'object' && openclaw.version) {
      return parseVersion(openclaw.version);
    }
  }
  return null;
}

/**
 * Compare two semver strings numerically.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1} Negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a, b) {
  const left = String(a || '').replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || '').replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

/**
 * Return a deduplicated list of common Node.js installation paths on Windows.
 * Environment variables (`LOCALAPPDATA`, `USERPROFILE`) are consulted when
 * available.
 * @returns {string[]}
 */
function getWindowsNodeCandidatePaths() {
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ];

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
  }

  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'nodejs', 'node.exe'));
  }

  return [...new Set(candidates)];
}

/**
 * Return a deduplicated list of common pnpm/npm shim paths on Windows for
 * the given command (e.g. `'pnpm'`, `'openclaw'`).
 * @param {string} command - Command name without extension.
 * @returns {string[]}
 */
function getWindowsShimCandidatePaths(command) {
  const candidates = [];

  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', `${command}.cmd`));
    candidates.push(path.join(process.env.APPDATA, 'npm', `${command}.exe`));
  }

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'pnpm', `${command}.cmd`));
    candidates.push(path.join(process.env.LOCALAPPDATA, 'pnpm', `${command}.exe`));
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'pnpm', `${command}.cmd`));
  }

  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', `${command}.cmd`));
    candidates.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'pnpm', `${command}.cmd`));
  }

  return [...new Set(candidates)];
}

/**
 * Iterate over `candidatePaths`, skip paths that don't exist, and return the
 * first one that responds successfully to the given `args`.  Returns `null`
 * when no candidate succeeds.
 * @param {string[]} args           - Arguments passed to each candidate.
 * @param {string[]} candidatePaths - Absolute paths to try in order.
 * @returns {Promise<{installed: boolean, version: string|null, raw: string, error: null, path: string}|null>}
 */
async function detectWindowsCandidateBinary(args, candidatePaths) {
  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const result = await runCommand(candidate, args);
      const version = parseVersion(result.stdout || result.stderr);
      return {
        installed: true,
        version,
        raw: (result.stdout || result.stderr || '').trim(),
        error: null,
        path: candidate,
      };
    } catch {
      // Continue trying other candidate locations.
    }
  }

  return null;
}

/**
 * Detect whether a binary is available and retrieve its version string.
 * On Windows, common installation paths are checked as a fallback when the
 * command is not on PATH.
 * @param {string}   command    - Command name (e.g. `'node'`, `'pnpm'`).
 * @param {string[]} [args]     - Arguments used to probe the version; defaults
 *   to `['--version']`.
 * @returns {Promise<{installed: boolean, version: string|null, raw: string, error: string|null, path?: string}>}
 */
async function detectBinary(command, args = ['--version']) {
  try {
    const result = await runCommand(command, args);
    const version = parseVersion(result.stdout || result.stderr);
    return {
      installed: true,
      version,
      raw: (result.stdout || result.stderr || '').trim(),
      error: null,
    };
  } catch (error) {
    if (process.platform === 'win32') {
      const candidatePaths = command === 'node'
        ? getWindowsNodeCandidatePaths()
        : getWindowsShimCandidatePaths(command);
      const fallback = await detectWindowsCandidateBinary(args, candidatePaths);
      if (fallback) {
        return fallback;
      }
    }

    const notFound = error && (error.code === 'ENOENT' || /not recognized|not found/i.test(error.message));
    return {
      installed: false,
      version: null,
      raw: '',
      error: notFound ? `${command} not found` : error.message,
    };
  }
}

/**
 * Detect the installed versions of node, pnpm and openclaw in parallel.
 * Falls back to `pnpm ls -g` for openclaw when its CLI binary is not found.
 * @returns {Promise<{
 *   node:     {installed: boolean, version: string|null, supported: boolean},
 *   pnpm:     {installed: boolean, version: string|null},
 *   openclaw: {installed: boolean, version: string|null},
 * }>}
 */
async function inspectEnvironment() {
  const [node, pnpm, openclawCli] = await Promise.all([
    detectBinary('node', ['--version']),
    detectBinary('pnpm', ['--version']),
    detectBinary('openclaw', ['--version']),
  ]);

  let openclaw = openclawCli;
  if (!openclawCli.installed || !openclawCli.version) {
    try {
      const listed = await runCommand('pnpm', ['ls', '-g', 'openclaw', '--json', '--depth', '0']);
      const listedVersion = parseOpenclawVersionFromPnpmList(listed.stdout || listed.stderr);
      if (listedVersion) {
        openclaw = {
          installed: true,
          version: listedVersion,
          raw: (listed.stdout || listed.stderr || '').trim(),
          error: null,
        };
      }
    } catch {
      // Ignore pnpm ls errors and keep CLI detection result.
    }
  }

  const nodeMajor = node.version ? Number.parseInt(node.version.split('.')[0], 10) : null;

  return {
    node: {
      ...node,
      supported: node.installed && Number.isInteger(nodeMajor) && nodeMajor >= 18,
    },
    pnpm,
    openclaw,
  };
}

/**
 * Return the argument list for the pnpm global-install command.
 * @returns {string[]}
 */
function getInstallCommandArgs() {
  return ['add', '-g', OPENCLAW_PACKAGE_SPEC, `--registry=${PNPM_REGISTRY}`];
}

/**
 * Return the full install command as a human-readable string.
 * @returns {string}
 */
function getInstallCommandString() {
  return `pnpm ${getInstallCommandArgs().join(' ')}`;
}

/**
 * Run `pnpm add -g openclaw@latest` with the npmmirror registry.
 * @param {object} [options] - Options forwarded to `runCommand`.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function installOpenclaw(options = {}) {
  return runCommand('pnpm', getInstallCommandArgs(), options);
}

module.exports = {
  PNPM_REGISTRY,
  OPENCLAW_PACKAGE_SPEC,
  runCommand,
  detectBinary,
  inspectEnvironment,
  parseVersion,
  compareVersions,
  parseOpenclawVersionFromPnpmList,
  getExecutableCandidates,
  getWindowsNodeCandidatePaths,
  getWindowsShimCandidatePaths,
  getInstallCommandArgs,
  getInstallCommandString,
  installOpenclaw,
};