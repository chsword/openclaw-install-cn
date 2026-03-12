'use strict';

const { spawn } = require('child_process');

const PNPM_REGISTRY = 'https://registry.npmmirror.com';
const OPENCLAW_PACKAGE_SPEC = 'openclaw@latest';
const NODEJS_DOWNLOAD_URL = 'https://nodejs.org/zh-cn/download';

function getExecutableName(command) {
  if (process.platform !== 'win32') {
    return command;
  }
  if (command.endsWith('.cmd') || command.endsWith('.exe')) {
    return command;
  }
  return `${command}.cmd`;
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(getExecutableName(command), args, {
      shell: false,
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

      const error = new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
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

async function installPnpm(options = {}) {
  return runCommand('npm', ['install', '-g', 'pnpm', `--registry=${PNPM_REGISTRY}`], options);
}

async function installNodejs(options = {}) {
  const platform = process.platform;

  if (platform === 'win32') {
    return runCommand('winget', [
      'install',
      '--id', 'OpenJS.NodeJS.LTS',
      '-e',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ], options);
  }

  if (platform === 'darwin') {
    return runCommand('brew', ['install', 'node'], options);
  }

  throw new Error(`当前系统不支持自动安装 Node.js，请手动安装：${NODEJS_DOWNLOAD_URL}`);
}

module.exports = {
  PNPM_REGISTRY,
  OPENCLAW_PACKAGE_SPEC,
  NODEJS_DOWNLOAD_URL,
  runCommand,
  detectBinary,
  inspectEnvironment,
  parseVersion,
  compareVersions,
  parseOpenclawVersionFromPnpmList,
  getInstallCommandArgs,
  getInstallCommandString,
  installOpenclaw,
  installPnpm,
  installNodejs,
};