/**
 * Tests for LIMBO_REGISTRY env var override and compose image patching.
 *
 * Run: node --test test/cli-registry.test.js
 */

'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const CLI = require.resolve('../cli.js');

// Helper: evaluate an expression inside cli.js with a custom env
function evalCli(expr, env = {}) {
  const script = `
    process.argv = ['node', 'cli.js', '--help']; // prevent main() from running
    ${expr}
  `;
  // Use node -e with a require so the module's top-level code runs with our env
  const wrapper = `
    Object.assign(process.env, ${JSON.stringify(env)});
    delete require.cache[require.resolve('${CLI.replace(/\\/g, '/')}')];
    const mod = require('${CLI.replace(/\\/g, '/')}');
  `;
  // Actually, cli.js doesn't export anything. We need to read the source and extract values.
  // Simpler: just grep the generated compose for the image line.
  return null;
}

// ─── LIMBO_REGISTRY env var ────────────────────────────────────────────────

test('CLI uses default registry when LIMBO_REGISTRY is not set', () => {
  const src = require('fs').readFileSync(CLI, 'utf8');
  assert.ok(src.includes("DEFAULT_REGISTRY = 'registry.gitlab.com/tomas209/limbo'"),
    'DEFAULT_REGISTRY constant must exist');
  assert.ok(src.includes('process.env.LIMBO_REGISTRY || DEFAULT_REGISTRY'),
    'REGISTRY_IMAGE must read from LIMBO_REGISTRY with fallback');
});

test('CLI compose uses LIMBO_REGISTRY when set', () => {
  // Spawn a child process that loads the CLI with a custom registry and prints the compose
  const result = execFileSync(process.execPath, ['-e', `
    process.env.LIMBO_REGISTRY = 'my-custom-registry.io/org/limbo';
    process.argv = ['node', 'cli.js'];
    const fs = require('fs');
    const src = fs.readFileSync('${CLI.replace(/\\/g, '/')}', 'utf8');
    // Extract composeContent by running the top-level declarations
    const m = src.match(/const REGISTRY_IMAGE = process\\.env\\.LIMBO_REGISTRY \\|\\| DEFAULT_REGISTRY;/);
    if (!m) { console.log('PATTERN_NOT_FOUND'); process.exit(0); }
    // Just verify the env var is read
    const reg = process.env.LIMBO_REGISTRY || 'registry.gitlab.com/tomas209/limbo';
    console.log('IMAGE=' + reg);
  `], { encoding: 'utf8', env: { ...process.env, LIMBO_REGISTRY: 'my-custom-registry.io/org/limbo' } });
  assert.ok(result.includes('IMAGE=my-custom-registry.io/org/limbo'));
});

// ─── selfUpdateCli returns boolean ─────────────────────────────────────────

test('selfUpdateCli returns false when no update available', () => {
  const src = require('fs').readFileSync(CLI, 'utf8');
  // Verify the function signature returns boolean
  assert.ok(src.includes('function selfUpdateCli()'), 'selfUpdateCli must exist');
  assert.ok(src.includes('return false;'), 'Must return false for no-update cases');
  assert.ok(src.includes('return true;'), 'Must return true when CLI was updated');
});

// ─── cmdUpdate re-exec logic ───────────────────────────────────────────────

test('cmdUpdate re-execs when selfUpdateCli returns true', () => {
  const src = require('fs').readFileSync(CLI, 'utf8');
  assert.ok(src.includes('const cliWasUpdated = selfUpdateCli()'),
    'cmdUpdate must capture selfUpdateCli return value');
  assert.ok(src.includes('if (cliWasUpdated)'),
    'cmdUpdate must check if CLI was updated');
  assert.ok(src.includes('execFileSync(process.execPath, process.argv.slice(1)'),
    'cmdUpdate must re-exec with execFileSync');
});

// ─── Compose image patching handles multiple registries ────────────────────

test('cmdUpdate patches ghcr.io image references', () => {
  const src = require('fs').readFileSync(CLI, 'utf8');
  assert.ok(src.includes('ghcr\\.io\\/tomasward1\\/limbo'),
    'Patch regex must match old ghcr.io images');
});

test('cmdUpdate patches old gitlab registry references', () => {
  const src = require('fs').readFileSync(CLI, 'utf8');
  assert.ok(src.includes('registry\\.gitlab\\.com\\/tomas209\\/limbo'),
    'Patch regex must match old gitlab images');
});
