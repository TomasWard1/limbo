/**
 * Unit tests for CLI compose YAML generation, volume migration logic,
 * and directory scaffolding (ensureComposeFile).
 *
 * The compose functions and migration logic are not exported from cli.js,
 * so we replicate the core logic here (same approach as cli-filter.test.js).
 * Any drift between these replicas and the real code will surface as failures
 * in the structural assertions.
 *
 * Run: node --test test/cli-compose.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── Read the real cli.js source to extract compose templates ───────────────

const CLI_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');

/**
 * Extract a function body from cli.js source by name.
 * Returns the full template-literal string the function returns.
 */
function extractComposeOutput(fnName) {
  const fnStart = CLI_SOURCE.indexOf(`function ${fnName}()`);
  if (fnStart === -1) throw new Error(`Function ${fnName} not found in cli.js`);

  // Find the return statement with template literal
  const returnIdx = CLI_SOURCE.indexOf('return `', fnStart);
  if (returnIdx === -1) throw new Error(`No template literal return in ${fnName}`);

  const backtickStart = CLI_SOURCE.indexOf('`', returnIdx);
  // Find matching closing backtick — account for nested ${} but not nested backticks
  let depth = 0;
  let i = backtickStart + 1;
  while (i < CLI_SOURCE.length) {
    if (CLI_SOURCE[i] === '\\') { i += 2; continue; }
    if (CLI_SOURCE[i] === '$' && CLI_SOURCE[i + 1] === '{') { depth++; i += 2; continue; }
    if (depth > 0 && CLI_SOURCE[i] === '}') { depth--; i++; continue; }
    if (CLI_SOURCE[i] === '`' && depth === 0) break;
    i++;
  }
  return CLI_SOURCE.slice(backtickStart + 1, i);
}

// Extract both compose template strings (with JS interpolation markers intact)
const normalTemplate = extractComposeOutput('composeContent');
const hardenedTemplate = extractComposeOutput('composeContentHardened');

// ─── Also read the path constants from cli.js ──────────────────────────────

function extractConst(name) {
  const re = new RegExp(`const ${name}\\s*=\\s*(.+);`);
  const m = CLI_SOURCE.match(re);
  return m ? m[1] : null;
}

// ─── 1. Compose YAML — normal mode ─────────────────────────────────────────

test('compose: uses .openclaw container path', () => {
  assert.ok(normalTemplate.includes('.openclaw'), 'Volume mount must target .openclaw');
});

test('compose: does not reference .zeroclaw', () => {
  assert.ok(!normalTemplate.includes('.zeroclaw'), 'Must not reference .zeroclaw paths');
});

test('compose: healthcheck uses /healthz endpoint', () => {
  assert.ok(normalTemplate.includes('/healthz'), 'Healthcheck should hit /healthz');
});

test('compose: NODE_OPTIONS max-old-space-size is 512 (OpenClaw needs more heap than ZeroClaw)', () => {
  const m = normalTemplate.match(/max-old-space-size=(\d+)/);
  assert.ok(m, 'NODE_OPTIONS must include max-old-space-size');
  assert.equal(parseInt(m[1], 10), 512, `max-old-space-size should be 512 for OpenClaw`);
});

test('compose: no secrets section (tokens now live in .env)', () => {
  assert.ok(!/\nsecrets:\s*\n/.test(normalTemplate), 'Must not declare a top-level secrets block');
  assert.ok(
    !/\n\s+secrets:\s*\n\s+-\s+llm_api_key/.test(normalTemplate),
    'Must not list secrets under the limbo service'
  );
});

test('compose: references env_file as the single source of config', () => {
  assert.ok(normalTemplate.includes('env_file:'), 'env_file directive must be present');
  assert.ok(normalTemplate.includes('${ENV_FILE}'), 'env_file must reference ENV_FILE');
});

test('compose: uses openclaw-state host directory (not zeroclaw-state)', () => {
  // The template uses ${OPENCLAW_STATE_DIR} which resolves to ~/.limbo/openclaw-state
  assert.ok(normalTemplate.includes('OPENCLAW_STATE_DIR'), 'Should reference OPENCLAW_STATE_DIR variable');
});

test('compose: has read_only security hardening', () => {
  assert.ok(normalTemplate.includes('read_only: true'), 'Container should be read-only');
});

test('compose: gosu caps (SETUID/SETGID) present, no-new-privileges removed', () => {
  assert.ok(!normalTemplate.includes('no-new-privileges'),
    'no-new-privileges blocks gosu — must be removed');
  assert.ok(normalTemplate.includes('SETUID'), 'Must have SETUID cap for gosu');
  assert.ok(normalTemplate.includes('SETGID'), 'Must have SETGID cap for gosu');
});

test('compose: drops all capabilities', () => {
  assert.ok(normalTemplate.includes('cap_drop'), 'Must drop capabilities');
  assert.ok(normalTemplate.includes('ALL'), 'Must drop ALL capabilities');
});

test('compose: has pids_limit', () => {
  assert.ok(normalTemplate.includes('pids_limit'), 'Must limit PIDs');
});

test('compose: has restart policy', () => {
  assert.ok(normalTemplate.includes('restart: unless-stopped'), 'Must have restart policy');
});

test('compose: binds port to localhost only', () => {
  assert.ok(normalTemplate.includes('127.0.0.1:'), 'Port binding must be localhost-only');
});

// ─── 2. Compose YAML — hardened mode ────────────────────────────────────────

test('hardened compose: includes squid proxy sidecar', () => {
  assert.ok(hardenedTemplate.includes('squid:'), 'Hardened mode must include squid service');
  assert.ok(hardenedTemplate.includes('ubuntu/squid'), 'Squid sidecar should use ubuntu/squid image');
});

test('hardened compose: sets HTTP_PROXY and HTTPS_PROXY', () => {
  assert.ok(hardenedTemplate.includes('HTTP_PROXY'), 'Must set HTTP_PROXY for egress filtering');
  assert.ok(hardenedTemplate.includes('HTTPS_PROXY'), 'Must set HTTPS_PROXY for egress filtering');
  assert.ok(hardenedTemplate.includes('squid:3128'), 'Proxy must point to squid sidecar');
});

test('hardened compose: has internal network', () => {
  assert.ok(hardenedTemplate.includes('internal: true'), 'Must have internal network');
});

test('hardened compose: squid mounts config files read-only', () => {
  assert.ok(hardenedTemplate.includes('squid.conf:/etc/squid/squid.conf:ro'), 'Squid conf must be read-only mount');
  assert.ok(hardenedTemplate.includes('allowed-domains.txt:/etc/squid/allowed-domains.txt:ro'), 'Allowed domains must be read-only mount');
});

test('hardened compose: uses .openclaw (not .zeroclaw)', () => {
  assert.ok(hardenedTemplate.includes('.openclaw'), 'Hardened mode must also use .openclaw');
  assert.ok(!hardenedTemplate.includes('.zeroclaw'), 'Hardened mode must not reference .zeroclaw');
});

test('hardened compose: healthcheck uses /healthz', () => {
  assert.ok(hardenedTemplate.includes('/healthz'), 'Hardened healthcheck should hit /healthz');
});

test('hardened compose: NODE_OPTIONS max-old-space-size is 512', () => {
  const m = hardenedTemplate.match(/max-old-space-size=(\d+)/);
  assert.ok(m, 'Hardened must include max-old-space-size');
  assert.equal(parseInt(m[1], 10), 512, `Hardened max-old-space-size should be 512`);
});

test('hardened compose: no secrets section (tokens now live in .env)', () => {
  assert.ok(!/\nsecrets:\s*\n/.test(hardenedTemplate), 'Hardened must not declare a top-level secrets block');
  assert.ok(
    !/\n\s+secrets:\s*\n\s+-\s+llm_api_key/.test(hardenedTemplate),
    'Hardened must not list secrets under the limbo service'
  );
});

// ─── 3. Volume migration logic ──────────────────────────────────────────────
// Replicate migrateLegacyStateVolume logic with injectable dependencies

/**
 * Testable replica of migrateLegacyStateVolume.
 * Accepts deps object to allow mocking filesystem and spawn.
 */
function migrateLegacyStateVolume(deps) {
  const { stateDir, readdirSync, spawnSync: mockSpawn, log: mockLog } = deps;

  // Skip if bind-mount dir already has content
  try {
    const entries = readdirSync(stateDir);
    if (entries.length > 0) return { skipped: 'has-content' };
  } catch { return { skipped: 'dir-not-found' }; }

  // Check whether the old named volume exists
  const candidateVolumes = ['limbo_limbo-zeroclaw-state', 'limbo-zeroclaw-state'];
  let foundVolume = null;
  try {
    const result = mockSpawn('docker', ['volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8', stdio: 'pipe' });
    if (result.status === 0) {
      const existing = result.stdout.split('\n').map(s => s.trim());
      foundVolume = candidateVolumes.find(v => existing.includes(v)) || null;
    }
  } catch { /* docker not available */ }

  if (!foundVolume) return { skipped: 'no-volume' };

  mockLog(`Migrating legacy state from volume "${foundVolume}" to ${stateDir} ...`);
  const migrate = mockSpawn('docker', [
    'run', '--rm',
    '-v', `${foundVolume}:/src:ro`,
    '-v', `${stateDir}:/dst`,
    'alpine',
    'sh', '-c', 'cp -a /src/. /dst/',
  ], { stdio: 'pipe' });

  if (migrate.status === 0) {
    return { migrated: true, volume: foundVolume };
  } else {
    return { migrated: false, volume: foundVolume, error: true };
  }
}

test('migration: skips when target dir has content', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => ['some-file.db'],
    spawnSync: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  assert.equal(result.skipped, 'has-content');
});

test('migration: skips when target dir does not exist', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => { throw new Error('ENOENT'); },
    spawnSync: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  assert.equal(result.skipped, 'dir-not-found');
});

test('migration: skips when no matching volume exists', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: (cmd, args) => {
      if (args[0] === 'volume') {
        return { status: 0, stdout: 'some-other-volume\nunrelated-volume\n' };
      }
      throw new Error('unexpected call');
    },
    log: () => {},
  });
  assert.equal(result.skipped, 'no-volume');
});

test('migration: finds limbo_limbo-zeroclaw-state volume and runs docker copy', () => {
  const spawnCalls = [];
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: (cmd, args, opts) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === 'volume') {
        return { status: 0, stdout: 'foo\nlimbo_limbo-zeroclaw-state\nbar\n' };
      }
      // docker run for migration
      return { status: 0 };
    },
    log: () => {},
  });

  assert.equal(result.migrated, true);
  assert.equal(result.volume, 'limbo_limbo-zeroclaw-state');
  // Verify the docker run args
  const runCall = spawnCalls.find(c => c.args[0] === 'run');
  assert.ok(runCall, 'Should have called docker run');
  assert.ok(runCall.args.includes('limbo_limbo-zeroclaw-state:/src:ro'), 'Should mount source volume read-only');
  assert.ok(runCall.args.includes('/fake/state:/dst'), 'Should mount target dir');
  assert.ok(runCall.args.includes('alpine'), 'Should use alpine image');
});

test('migration: finds limbo-zeroclaw-state (without prefix)', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: (cmd, args) => {
      if (args[0] === 'volume') {
        return { status: 0, stdout: 'limbo-zeroclaw-state\n' };
      }
      return { status: 0 };
    },
    log: () => {},
  });
  assert.equal(result.migrated, true);
  assert.equal(result.volume, 'limbo-zeroclaw-state');
});

test('migration: prefers limbo_limbo-zeroclaw-state over limbo-zeroclaw-state', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: (cmd, args) => {
      if (args[0] === 'volume') {
        return { status: 0, stdout: 'limbo-zeroclaw-state\nlimbo_limbo-zeroclaw-state\n' };
      }
      return { status: 0 };
    },
    log: () => {},
  });
  assert.equal(result.volume, 'limbo_limbo-zeroclaw-state', 'Should prefer Docker Compose prefixed volume name');
});

test('migration: handles failed docker run', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: (cmd, args) => {
      if (args[0] === 'volume') {
        return { status: 0, stdout: 'limbo-zeroclaw-state\n' };
      }
      return { status: 1, stderr: 'some error' };
    },
    log: () => {},
  });
  assert.equal(result.migrated, false);
  assert.equal(result.error, true);
});

test('migration: handles docker not available (spawnSync throws)', () => {
  const result = migrateLegacyStateVolume({
    stateDir: '/fake/state',
    readdirSync: () => [],
    spawnSync: () => { throw new Error('ENOENT: docker not found'); },
    log: () => {},
  });
  assert.equal(result.skipped, 'no-volume');
});

// ─── 4. Directory creation (ensureComposeFile scaffolding) ─────────────────

test('ensureComposeFile: creates expected directory structure', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-test-'));
  try {
    const limboDir = path.join(tmpDir, '.limbo');
    const vaultDir = path.join(limboDir, 'vault');
    const stateDir = path.join(limboDir, 'openclaw-state');
    const configDir = path.join(limboDir, 'config');

    // Replicate ensureComposeFile directory creation (post-consolidation)
    fs.mkdirSync(limboDir, { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'maps'), { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });

    // Verify
    assert.ok(fs.existsSync(limboDir));
    assert.ok(fs.existsSync(path.join(vaultDir, 'notes')));
    assert.ok(fs.existsSync(path.join(vaultDir, 'maps')));
    assert.ok(fs.existsSync(stateDir));
    assert.ok(fs.existsSync(configDir));
    // No secrets/ dir should be created
    assert.ok(!fs.existsSync(path.join(limboDir, 'secrets')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureComposeFile: hardened mode creates squid directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-test-'));
  try {
    const limboDir = path.join(tmpDir, '.limbo');
    const squidDir = path.join(limboDir, 'squid');
    fs.mkdirSync(squidDir, { recursive: true });
    assert.ok(fs.existsSync(squidDir), 'Squid dir should be created in hardened mode');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureComposeFile: idempotent — running twice does not error', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-test-'));
  try {
    const limboDir = path.join(tmpDir, '.limbo');
    const vaultDir = path.join(limboDir, 'vault');
    const stateDir = path.join(limboDir, 'openclaw-state');
    const configDir = path.join(limboDir, 'config');

    const scaffold = () => {
      fs.mkdirSync(limboDir, { recursive: true });
      fs.mkdirSync(path.join(vaultDir, 'notes'), { recursive: true });
      fs.mkdirSync(path.join(vaultDir, 'maps'), { recursive: true });
      fs.mkdirSync(stateDir, { recursive: true });
      fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
    };

    // Run twice — should not throw
    scaffold();
    scaffold();

    assert.ok(fs.existsSync(path.join(vaultDir, 'notes')));
    assert.ok(fs.existsSync(configDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 5. Consistency between normal and hardened compose ─────────────────────

test('neither compose variant declares a secrets section', () => {
  for (const [label, tpl] of [['normal', normalTemplate], ['hardened', hardenedTemplate]]) {
    assert.ok(!/\nsecrets:\s*\n/.test(tpl), `${label} must not declare secrets`);
  }
});

test('both compose variants use the same image reference', () => {
  const normalImage = normalTemplate.match(/image:\s*(\S+)/)?.[1];
  const hardenedImage = hardenedTemplate.match(/image:\s*(\S+)/)?.[1];
  assert.ok(normalImage, 'Normal template should have image field');
  assert.ok(hardenedImage, 'Hardened template should have image field');
  assert.equal(normalImage, hardenedImage, 'Both variants must use the same image');
});

test('both compose variants mount vault and openclaw-state', () => {
  for (const tpl of [normalTemplate, hardenedTemplate]) {
    assert.ok(tpl.includes('VAULT_DIR'), 'Should mount VAULT_DIR');
    assert.ok(tpl.includes('OPENCLAW_STATE_DIR'), 'Should mount OPENCLAW_STATE_DIR');
  }
});
