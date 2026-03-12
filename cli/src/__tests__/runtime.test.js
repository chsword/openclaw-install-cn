'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseVersion,
  parseOpenclawVersionFromPnpmList,
  compareVersions,
  getExecutableCandidates,
  getWindowsNodeCandidatePaths,
  getWindowsShimCandidatePaths,
  getInstallCommandArgs,
  getInstallCommandString,
  PNPM_REGISTRY,
  OPENCLAW_PACKAGE_SPEC,
} = require('../lib/runtime');

function withWindowsLikeEnv(fn) {
  const previous = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE,
  };

  process.env.APPDATA = 'C:\\Users\\runner\\AppData\\Roaming';
  process.env.LOCALAPPDATA = 'C:\\Users\\runner\\AppData\\Local';
  process.env.USERPROFILE = 'C:\\Users\\runner';

  try {
    fn();
  } finally {
    if (previous.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = previous.APPDATA;
    if (previous.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.LOCALAPPDATA;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previous.USERPROFILE;
  }
}

describe('runtime', () => {
  test('parseVersion extracts semver from complex output', () => {
    assert.equal(parseVersion('OpenClaw CLI version v1.23.4'), '1.23.4');
  });

  test('parseVersion supports pre-release versions', () => {
    assert.equal(parseVersion('openclaw 2.0.0-beta.3'), '2.0.0-beta.3');
  });

  test('parseVersion returns null for empty input', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(undefined), null);
  });

  test('parseVersion returns first word when no semver pattern found', () => {
    assert.equal(parseVersion('foobar'), 'foobar');
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

  test('parseOpenclawVersionFromPnpmList returns null for invalid JSON', () => {
    assert.equal(parseOpenclawVersionFromPnpmList('not-json'), null);
  });

  test('parseOpenclawVersionFromPnpmList returns null when openclaw entry missing', () => {
    assert.equal(parseOpenclawVersionFromPnpmList(JSON.stringify([{ dependencies: {} }])), null);
    assert.equal(parseOpenclawVersionFromPnpmList(JSON.stringify([{}])), null);
  });

  test('compareVersions returns 0 for equal versions', () => {
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });

  test('compareVersions returns 1 when left is greater', () => {
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
  });

  test('compareVersions returns -1 when left is smaller', () => {
    assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  });

  test('compareVersions handles v prefix', () => {
    assert.equal(compareVersions('v1.2.3', 'v1.2.3'), 0);
    assert.equal(compareVersions('v2.0.0', '1.9.9'), 1);
  });

  test('getInstallCommandArgs includes package spec and registry', () => {
    const args = getInstallCommandArgs();
    assert.ok(Array.isArray(args));
    assert.ok(args.includes(OPENCLAW_PACKAGE_SPEC));
    assert.ok(args.some((a) => a.includes(PNPM_REGISTRY)));
  });

  test('getInstallCommandString produces a valid pnpm command', () => {
    const command = getInstallCommandString();
    assert.ok(command.startsWith('pnpm '));
    assert.ok(command.includes(`--registry=${PNPM_REGISTRY}`));
    assert.ok(command.includes(OPENCLAW_PACKAGE_SPEC));
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

  test('getExecutableCandidates returns command as-is on non-Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      assert.deepEqual(getExecutableCandidates('node'), ['node']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('getExecutableCandidates returns command unchanged when already has extension', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      assert.deepEqual(getExecutableCandidates('node.exe'), ['node.exe']);
      assert.deepEqual(getExecutableCandidates('pnpm.cmd'), ['pnpm.cmd']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('Windows fallback paths include common Node and shim locations', () => {
    withWindowsLikeEnv(() => {
      const nodeCandidates = getWindowsNodeCandidatePaths();
      const shimCandidates = getWindowsShimCandidatePaths('pnpm');
      assert.ok(nodeCandidates.includes('C:\\Program Files\\nodejs\\node.exe'));
      assert.ok(nodeCandidates.includes('C:\\Program Files (x86)\\nodejs\\node.exe'));
      assert.ok(shimCandidates.some((item) => item.endsWith('pnpm.cmd')));
    });
  });

  test('getWindowsNodeCandidatePaths deduplicates entries', () => {
    const candidates = getWindowsNodeCandidatePaths();
    assert.equal(candidates.length, new Set(candidates).size);
  });

  test('getWindowsShimCandidatePaths deduplicates entries', () => {
    withWindowsLikeEnv(() => {
      const candidates = getWindowsShimCandidatePaths('pnpm');
      assert.equal(candidates.length, new Set(candidates).size);
    });
  });
});
