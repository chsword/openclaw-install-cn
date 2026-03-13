'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  parseVersion,
  parseOpenclawVersionFromPnpmList,
  compareVersions,
  getInstallCommandString,
  getInstallCommandArgs,
  PNPM_REGISTRY,
  OPENCLAW_PACKAGE_SPEC,
  getExecutableCandidates,
  getWindowsNodeCandidatePaths,
  getWindowsNodeDirectoryCandidates,
  getNodeBundledNpmCandidates,
  getWindowsShimCandidatePaths,
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
    const out = 'OpenClaw CLI version v1.23.4 (build abc)';
    assert.equal(parseVersion(out), '1.23.4');
  });

  test('parseVersion supports pre-release versions', () => {
    const out = 'openclaw 2.0.0-beta.3';
    assert.equal(parseVersion(out), '2.0.0-beta.3');
  });

  test('parseVersion returns null for empty input', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(undefined), null);
  });

  test('parseVersion returns first word when no semver pattern found', () => {
    assert.equal(parseVersion('foobar'), 'foobar');
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

  test('getInstallCommandString uses npmmirror registry', () => {
    const command = getInstallCommandString();
    assert.ok(command.includes(`--registry=${PNPM_REGISTRY}`));
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

  test('getWindowsNodeCandidatePaths includes common install locations', () => {
    const candidates = getWindowsNodeCandidatePaths();
    assert.ok(candidates.includes('C:\\Program Files\\nodejs\\node.exe'));
    assert.ok(candidates.includes('C:\\Program Files (x86)\\nodejs\\node.exe'));
  });

  test('getWindowsNodeCandidatePaths deduplicates entries', () => {
    const candidates = getWindowsNodeCandidatePaths();
    assert.equal(candidates.length, new Set(candidates).size);
  });

  test('getWindowsNodeDirectoryCandidates returns parent directories of node paths', () => {
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const candidates = getWindowsNodeDirectoryCandidates(nodePath);
    // path.dirname behaviour is platform-dependent; verify the dirname of the
    // provided path is always included in the result.
    assert.ok(candidates.includes(path.dirname(nodePath)));
  });

  test('getWindowsNodeDirectoryCandidates handles null nodePath', () => {
    const candidates = getWindowsNodeDirectoryCandidates(null);
    assert.ok(Array.isArray(candidates));
    assert.ok(candidates.length > 0);
  });

  test('getWindowsNodeDirectoryCandidates deduplicates entries', () => {
    const candidates = getWindowsNodeDirectoryCandidates(null);
    assert.equal(candidates.length, new Set(candidates).size);
  });

  test('getNodeBundledNpmCandidates returns npm variants in node directories', () => {
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const candidates = getNodeBundledNpmCandidates(nodePath);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some((c) => c.endsWith('npm.cmd') || c.endsWith('npm') || c.endsWith('npm.exe')));
  });

  test('getNodeBundledNpmCandidates deduplicates entries', () => {
    const candidates = getNodeBundledNpmCandidates(null);
    assert.equal(candidates.length, new Set(candidates).size);
  });

  test('getWindowsShimCandidatePaths includes common shim directories', () => {
    withWindowsLikeEnv(() => {
      const candidates = getWindowsShimCandidatePaths('pnpm');
      assert.ok(candidates.some((item) => item.endsWith('pnpm.cmd')));
      assert.ok(candidates.some((item) => item.includes('npm')) || candidates.some((item) => item.includes('pnpm')));
    });
  });

  test('getWindowsShimCandidatePaths deduplicates entries', () => {
    withWindowsLikeEnv(() => {
      const candidates = getWindowsShimCandidatePaths('pnpm');
      assert.equal(candidates.length, new Set(candidates).size);
    });
  });
});
