'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PNPM_REGISTRY = 'https://registry.npmmirror.com';
const OPENCLAW_PACKAGE_SPEC = 'openclaw@latest';

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

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatForCmd(value) {
  const text = String(value);
  return /[\s"&|<>^()]/.test(text) ? quoteForCmd(text) : text;
}

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

function parseVersion(output) {
  const text = String(output || '').trim();
  if (!text) {
    return null;
  }

  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : text.split(/\s+/)[0];
}

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

function getInstallCommandArgs() {
  return ['add', '-g', OPENCLAW_PACKAGE_SPEC, `--registry=${PNPM_REGISTRY}`];
}

function getInstallCommandString() {
  return `pnpm ${getInstallCommandArgs().join(' ')}`;
}

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