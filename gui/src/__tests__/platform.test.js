'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const {
  getPlatform,
  getArch,
  getDefaultInstallDir,
  getArchiveExt,
  getPackageFilename,
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

  test('getDefaultInstallDir returns a non-empty string', () => {
    const dir = getDefaultInstallDir();
    assert.ok(typeof dir === 'string' && dir.length > 0);
  });

  test('getArchiveExt returns zip on win32', () => {
    assert.equal(getArchiveExt('win32'), 'zip');
  });

  test('getArchiveExt returns tar.gz on darwin', () => {
    assert.equal(getArchiveExt('darwin'), 'tar.gz');
  });

  test('getArchiveExt returns tar.gz on linux', () => {
    assert.equal(getArchiveExt('linux'), 'tar.gz');
  });

  test('getPackageFilename builds correct filename', () => {
    const fn = getPackageFilename('1.2.3', 'linux', 'x64');
    assert.equal(fn, 'openclaw-1.2.3-linux-x64.tar.gz');
  });

  test('getPackageFilename builds correct windows filename', () => {
    const fn = getPackageFilename('1.0.0', 'win32', 'x64');
    assert.equal(fn, 'openclaw-1.0.0-win32-x64.zip');
  });

  test('getPlatformLabel returns a non-empty string', () => {
    const label = getPlatformLabel();
    assert.ok(typeof label === 'string' && label.length > 0);
  });

  test('getPlatformLabel returns known label', () => {
    const label = getPlatformLabel();
    assert.ok(['Windows', 'macOS', 'Linux'].includes(label), `Unexpected label: ${label}`);
  });
});
