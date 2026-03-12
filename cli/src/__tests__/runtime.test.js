'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseVersion,
  parseOpenclawVersionFromPnpmList,
  getExecutableCandidates,
  getWindowsNodeCandidatePaths,
  getWindowsShimCandidatePaths,
} = require('../lib/runtime');

describe('runtime', () => {
  test('parseVersion extracts semver from complex output', () => {
    assert.equal(parseVersion('OpenClaw CLI version v1.23.4'), '1.23.4');
  });

  test('parseVersion supports pre-release versions', () => {
    assert.equal(parseVersion('openclaw 2.0.0-beta.3'), '2.0.0-beta.3');
  });

  test('parseOpenclawVersionFromPnpmList reads dependency version', () => {
    const out = JSON.stringify([
      {
        dependencies: {
          openclaw: {
            version: '3.2.1',
          },
        },
      },
    ]);
    assert.equal(parseOpenclawVersionFromPnpmList(out), '3.2.1');
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

  test('Windows fallback paths include common Node and shim locations', () => {
    const nodeCandidates = getWindowsNodeCandidatePaths();
    const shimCandidates = getWindowsShimCandidatePaths('pnpm');
    assert.ok(nodeCandidates.includes('C:\\Program Files\\nodejs\\node.exe'));
    assert.ok(nodeCandidates.includes('C:\\Program Files (x86)\\nodejs\\node.exe'));
    assert.ok(shimCandidates.some((item) => item.endsWith('pnpm.cmd')));
  });
});
