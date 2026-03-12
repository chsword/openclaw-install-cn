'use strict';

const { spawn } = require('child_process');

const PNPM_REGISTRY = 'https://registry.npmmirror.com';
const OPENCLAW_PACKAGE_SPEC = 'openclaw@latest';

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

  const match = text.match(/v?(\d+(?:\.\d+)+)/);
  return match ? match[1] : text.split(/\s+/)[0];
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
  const [node, pnpm, openclaw] = await Promise.all([
    detectBinary('node', ['--version']),
    detectBinary('pnpm', ['--version']),
    detectBinary('openclaw', ['--version']),
  ]);

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
  getInstallCommandArgs,
  getInstallCommandString,
  installOpenclaw,
};