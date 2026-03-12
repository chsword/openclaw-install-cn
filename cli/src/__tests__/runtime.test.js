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
    withWindowsLikeEnv(() => {
      const nodeCandidates = getWindowsNodeCandidatePaths();
      const shimCandidates = getWindowsShimCandidatePaths('pnpm');
      assert.ok(nodeCandidates.includes('C:\\Program Files\\nodejs\\node.exe'));
      assert.ok(nodeCandidates.includes('C:\\Program Files (x86)\\nodejs\\node.exe'));
      assert.ok(shimCandidates.some((item) => item.endsWith('pnpm.cmd')));
    });
  });
});
