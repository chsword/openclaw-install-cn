'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseVersion,
  parseOpenclawVersionFromPnpmList,
  getInstallCommandString,
  PNPM_REGISTRY,
  getExecutableCandidates,
  getWindowsNodeCandidatePaths,
  getWindowsShimCandidatePaths,
} = require('../lib/runtime');

describe('runtime', () => {
  test('parseVersion extracts semver from complex output', () => {
    const out = 'OpenClaw CLI version v1.23.4 (build abc)';
    assert.equal(parseVersion(out), '1.23.4');
  });

  test('parseVersion supports pre-release versions', () => {
    const out = 'openclaw 2.0.0-beta.3';
    assert.equal(parseVersion(out), '2.0.0-beta.3');
  });

  test('parseOpenclawVersionFromPnpmList reads dependencies.openclaw.version', () => {
    const out = JSON.stringify([
      {
        name: 'global',
        dependencies: {
          openclaw: {
            version: '3.2.1',
          },
        },
      },
    ]);
    assert.equal(parseOpenclawVersionFromPnpmList(out), '3.2.1');
  });

  test('parseOpenclawVersionFromPnpmList returns null for invalid payload', () => {
    assert.equal(parseOpenclawVersionFromPnpmList('not-json'), null);
    assert.equal(parseOpenclawVersionFromPnpmList(JSON.stringify({ foo: 'bar' })), null);
  });

  test('getInstallCommandString uses npmmirror registry', () => {
    const command = getInstallCommandString();
    assert.ok(command.includes(`--registry=${PNPM_REGISTRY}`));
  });

  test('getExecutableCandidates prefers node.exe on Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      assert.deepEqual(getExecutableCandidates('node'), ['node.exe', 'node']);
      assert.deepEqual(getExecutableCandidates('pnpm'), ['pnpm.cmd', 'pnpm.exe', 'pnpm']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('getWindowsNodeCandidatePaths includes common install locations', () => {
    const candidates = getWindowsNodeCandidatePaths();
    assert.ok(candidates.includes('C:\\Program Files\\nodejs\\node.exe'));
    assert.ok(candidates.includes('C:\\Program Files (x86)\\nodejs\\node.exe'));
  });

  test('getWindowsShimCandidatePaths includes common shim directories', () => {
    const candidates = getWindowsShimCandidatePaths('pnpm');
    assert.ok(candidates.some((item) => item.endsWith('pnpm.cmd')));
    assert.ok(candidates.some((item) => item.includes('npm')) || candidates.some((item) => item.includes('pnpm')));
  });
});
