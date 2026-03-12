'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  getPlatform,
  getArch,
  getPlatformLabel,
} = require('../lib/platform');

describe('platform', () => {
  test('getPlatform returns a known platform', () => {
    const p = getPlatform();
    assert.ok(['win32', 'darwin', 'linux'].includes(p), `Unexpected platform: ${p}`);
  });

  test('getArch returns a known arch', () => {
    const a = getArch();
    assert.ok(['x64', 'arm64', 'ia32'].includes(a), `Unexpected arch: ${a}`);
  });

  test('getPlatformLabel returns a known label', () => {
    const label = getPlatformLabel();
    assert.ok(['Windows', 'macOS', 'Linux'].includes(label), `Unexpected label: ${label}`);
  });
});
