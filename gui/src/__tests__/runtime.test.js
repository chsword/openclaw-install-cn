'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseVersion,
  parseOpenclawVersionFromPnpmList,
  getInstallCommandString,
  PNPM_REGISTRY,
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
});
