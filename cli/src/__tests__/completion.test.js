'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { generateBash, generateZsh, generateFish, SUBCOMMANDS } = require('../commands/completion');

describe('SUBCOMMANDS metadata', () => {
  test('contains all expected subcommands', () => {
    const names = SUBCOMMANDS.map((c) => c.name);
    assert.ok(names.includes('install'));
    assert.ok(names.includes('upgrade'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('config'));
    assert.ok(names.includes('version'));
    assert.ok(names.includes('completion'));
  });

  test('install subcommand has expected options', () => {
    const install = SUBCOMMANDS.find((c) => c.name === 'install');
    const flags = install.options.map((o) => o.flag);
    assert.ok(flags.includes('--force'));
  });
});

describe('generateBash', () => {
  test('returns a non-empty string', () => {
    const script = generateBash();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  test('defines the completion function _oclaw', () => {
    assert.ok(generateBash().includes('_oclaw()'));
  });

  test('registers the complete command for oclaw', () => {
    assert.ok(generateBash().includes('complete -F _oclaw oclaw'));
  });

  test('lists all subcommand names in the commands variable', () => {
    const script = generateBash();
    for (const cmd of SUBCOMMANDS) {
      assert.ok(script.includes(cmd.name), `bash script should include subcommand: ${cmd.name}`);
    }
  });

  test('includes install options', () => {
    const script = generateBash();
    assert.ok(script.includes('--force'));
  });
});

describe('generateZsh', () => {
  test('returns a non-empty string', () => {
    const script = generateZsh();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  test('starts with #compdef oclaw', () => {
    assert.ok(generateZsh().startsWith('#compdef oclaw'));
  });

  test('defines the _oclaw function', () => {
    assert.ok(generateZsh().includes('_oclaw()'));
  });

  test('lists all subcommand names', () => {
    const script = generateZsh();
    for (const cmd of SUBCOMMANDS) {
      assert.ok(script.includes(cmd.name), `zsh script should include subcommand: ${cmd.name}`);
    }
  });

  test('includes install options', () => {
    const script = generateZsh();
    assert.ok(script.includes('--force'));
  });
});

describe('generateFish', () => {
  test('returns a non-empty string', () => {
    const script = generateFish();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  test('uses complete -c oclaw syntax', () => {
    assert.ok(generateFish().includes('complete -c oclaw'));
  });

  test('lists all subcommand names', () => {
    const script = generateFish();
    for (const cmd of SUBCOMMANDS) {
      assert.ok(script.includes(cmd.name), `fish script should include subcommand: ${cmd.name}`);
    }
  });

  test('includes install options', () => {
    const script = generateFish();
    assert.ok(script.includes('--force') || script.includes('-l force'));
  });
});

describe('runCompletion', () => {
  test('runCompletion with unknown shell exits with code 1', () => {
    const { runCompletion } = require('../commands/completion');
    const origExit = process.exit;
    const origError = console.error;
    let exitCode;
    process.exit = (code) => { exitCode = code; };
    console.error = () => {};
    runCompletion({ shell: 'powershell' });
    process.exit = origExit;
    console.error = origError;
    assert.equal(exitCode, 1);
  });

  test('runCompletion defaults to bash when no shell specified', () => {
    const { runCompletion } = require('../commands/completion');
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
    runCompletion({});
    process.stdout.write = origWrite;
    const output = chunks.join('');
    assert.ok(output.includes('complete -F _oclaw oclaw'), 'default shell should be bash');
  });
});
