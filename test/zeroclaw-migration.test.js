/**
 * Integration tests for the OpenClaw → ZeroClaw migration.
 *
 * Validates that all config files, templates, and code references
 * are consistent after the migration. These tests run without
 * Docker and verify structural correctness only.
 *
 * Run: node --test test/zeroclaw-migration.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ─── Helper: read file relative to repo root ────────────────────────────────

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ─── 1. Old OpenClaw artifacts are removed ──────────────────────────────────

test('openclaw.json.template is deleted', () => {
  assert.ok(!exists('openclaw.json.template'), 'openclaw.json.template should not exist');
});

test('mcporter.json is deleted', () => {
  assert.ok(!exists('mcporter.json'), 'mcporter.json should not exist');
});

// ─── 2. New ZeroClaw config template exists and matches ZeroClaw schema ─────

test('config.toml.template exists', () => {
  assert.ok(exists('config.toml.template'));
});

test('config.toml.template contains required ZeroClaw sections', () => {
  const toml = read('config.toml.template');
  const required = [
    '[gateway]',
    '[mcp]',
    '[[mcp.servers]]',
  ];
  for (const section of required) {
    assert.ok(toml.includes(section), `Missing section: ${section}`);
  }
});

test('config.toml.template does NOT contain unsupported sections', () => {
  const toml = read('config.toml.template');
  const forbidden = [
    '[gateway.auth]',
    '[memory]',
    '[session]',
    '[agents.defaults]',
    '[channels.telegram]',
    '[mcp.limbo-vault]',
    '[security]',
    '[tools]',
  ];
  for (const section of forbidden) {
    assert.ok(!toml.includes(section), `Should not contain unsupported section: ${section}`);
  }
});

test('config.toml.template uses envsubst variables', () => {
  const toml = read('config.toml.template');
  const vars = ['${MODEL_PROVIDER}', '${MODEL_NAME}', '${LIMBO_PORT}', '${RUNTIME_REASONING_EFFORT}'];
  for (const v of vars) {
    assert.ok(toml.includes(v), `Missing envsubst variable: ${v}`);
  }
});

test('config.toml.template uses require_pairing for gateway auth', () => {
  const toml = read('config.toml.template');
  assert.ok(toml.includes('require_pairing = false'),
    'Gateway must use require_pairing (ZeroClaw schema)');
});

test('config.toml.template registers MCP server via [[mcp.servers]]', () => {
  const toml = read('config.toml.template');
  assert.ok(toml.includes('[[mcp.servers]]'));
  assert.ok(toml.includes('name = "limbo-vault"'));
  assert.ok(toml.includes('command = "node"'));
  assert.ok(toml.includes('"/app/mcp-server/index.js"'));
});

// ─── 3. Entrypoint conditionally appends Telegram config ────────────────────

test('entrypoint.sh appends channels_config.telegram conditionally', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('[channels_config.telegram]'),
    'Entrypoint must append [channels_config.telegram] section');
  assert.ok(ep.includes('allowed_users'),
    'Telegram config must include allowed_users');
});

// ─── 4. Dockerfile references ZeroClaw, not OpenClaw ────────────────────────

test('Dockerfile pulls ZeroClaw binary from official or custom image', () => {
  const df = read('Dockerfile');
  assert.ok(df.match(/FROM ghcr\.io\/(zeroclaw-labs|tomasward1)\/zeroclaw:\S+ AS zeroclaw/),
    'Dockerfile must pull ZeroClaw from ghcr.io/zeroclaw-labs/zeroclaw or ghcr.io/tomasward1/zeroclaw');
  assert.ok(df.includes('COPY --from=zeroclaw /usr/local/bin/zeroclaw /usr/local/bin/zeroclaw'));
});

test('Dockerfile does not reference openclaw or mcporter', () => {
  const df = read('Dockerfile');
  assert.ok(!df.toLowerCase().includes('openclaw'), 'Dockerfile should not mention openclaw');
  assert.ok(!df.toLowerCase().includes('mcporter'), 'Dockerfile should not mention mcporter');
});

test('Dockerfile creates .zeroclaw directory', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('.zeroclaw'), 'Dockerfile must pre-create .zeroclaw directory');
});

test('Dockerfile copies config.toml.template', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('config.toml.template'));
});

// ─── 5. docker-compose.yml uses ZeroClaw volumes and healthcheck ────────────

test('docker-compose.yml uses bind mount for zeroclaw-state', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('zeroclaw-state'), 'Must include zeroclaw-state bind mount');
  assert.ok(dc.includes('.zeroclaw'), 'Bind mount must target .zeroclaw directory');
  assert.ok(!dc.includes('limbo-zeroclaw-state'), 'Must not use named volume — bind mount expected');
  assert.ok(!dc.includes('limbo-openclaw-state'), 'Must not reference old openclaw volume');
});

test('docker-compose.yml healthcheck uses zeroclaw status with wizard fallback', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('zeroclaw status --format=exit-code'), 'Healthcheck should try zeroclaw status first');
  assert.ok(dc.includes('node -e'), 'Healthcheck should fall back to Node HTTP check for setup mode');
});

test('docker-compose.yml NODE_OPTIONS is 256MB or less', () => {
  const dc = read('docker-compose.yml');
  const match = dc.match(/max-old-space-size=(\d+)/);
  assert.ok(match, 'NODE_OPTIONS should set max-old-space-size');
  assert.ok(parseInt(match[1], 10) <= 256, 'max-old-space-size should be ≤256 (ZeroClaw is Rust, only MCP server needs Node)');
});

test('docker-compose.yml mounts .zeroclaw state dir', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('/home/limbo/.zeroclaw'));
});

// ─── 6. Entrypoint uses ZeroClaw ────────────────────────────────────────────

test('entrypoint.sh starts zeroclaw daemon', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('exec zeroclaw daemon'));
});

test('entrypoint.sh does not reference openclaw binary', () => {
  const ep = read('scripts/entrypoint.sh');
  // Allow references in comments about migration, but not as command invocations
  const lines = ep.split('\n').filter(l => !l.trim().startsWith('#'));
  const nonCommentContent = lines.join('\n');
  assert.ok(!nonCommentContent.includes('openclaw '), 'Entrypoint should not invoke openclaw binary');
});

test('entrypoint.sh uses ZEROCLAW_STATE_DIR and ZEROCLAW_CONFIG_PATH', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('ZEROCLAW_STATE_DIR'));
  assert.ok(ep.includes('ZEROCLAW_CONFIG_PATH'));
});

test('entrypoint.sh renders config.toml from template via envsubst', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('config.toml.template'));
  assert.ok(ep.includes('envsubst'));
});

// ─── 7. Migration version bumped correctly ──────────────────────────────────

test('migration index has CURRENT_DATA_VERSION = 4', () => {
  const idx = read('migrations/index.js');
  assert.ok(idx.includes('CURRENT_DATA_VERSION = 4'));
});

test('migration 003-zeroclaw-migration.js exists', () => {
  assert.ok(exists('migrations/versions/003-zeroclaw-migration.js'));
});

test('migration 003 exports version 3 and up function', () => {
  const mig = read('migrations/versions/003-zeroclaw-migration.js');
  assert.ok(mig.includes('version = 3') || mig.includes('version: 3'),
    'Migration 003 must export version = 3');
  // Check for function export - can be export const up or export function up
  assert.ok(mig.includes('up') && (mig.includes('export') || mig.includes('module.exports')),
    'Migration 003 must export an up function');
});

test('migration 004-fts5-search.js exists', () => {
  assert.ok(exists('migrations/versions/004-fts5-search.js'));
});

test('migration 004 exports version 4 and up function', async () => {
  const mod = await import(path.join(ROOT, 'migrations/versions/004-fts5-search.js'));
  assert.strictEqual(mod.version, 4, 'Migration 004 must export version = 4');
  assert.strictEqual(typeof mod.up, 'function', 'Migration 004 must export an up function');
});

// ─── 8. CLI filter suppresses both openclaw and zeroclaw branding ───────────

test('cli-filter.test.js classify regex handles both brands', () => {
  const t = read('test/cli-filter.test.js');
  assert.ok(t.includes('openclaw|zeroclaw'), 'Filter regex must suppress both openclaw and zeroclaw branding');
});

// ─── 9. No stale OPENCLAW env vars in core config files ─────────────────────

test('.env.example does not use OPENCLAW_ prefix', () => {
  if (!exists('.env.example')) return; // optional file
  const env = read('.env.example');
  assert.ok(!env.includes('OPENCLAW_'), '.env.example should not have OPENCLAW_ prefixed vars');
});

test('docker-compose.yml does not use OPENCLAW_ env vars', () => {
  const dc = read('docker-compose.yml');
  assert.ok(!dc.includes('OPENCLAW_'));
});

// ─── 10. Workspace docs updated ─────────────────────────────────────────────

test('IDENTITY.md does not reference OpenClaw gateway', () => {
  const id = read('workspace/templates/IDENTITY.md');
  assert.ok(!id.includes('OpenClaw'), 'IDENTITY.md should reference ZeroClaw, not OpenClaw');
});

test('TOOLS.md does not reference mcporter', () => {
  const tools = read('workspace/system/TOOLS.md');
  assert.ok(!tools.toLowerCase().includes('mcporter'), 'TOOLS.md should not reference mcporter');
});

// ─── 11. Package.json includes zeroclaw keyword ─────────────────────────────

test('package.json keywords include zeroclaw', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.keywords.includes('zeroclaw'), 'package.json keywords should include "zeroclaw"');
});

// ─── 12. Setup server uses ZeroClaw paths ───────────────────────────────────

test('setup-server uses ZEROCLAW_STATE not OPENCLAW_STATE', () => {
  const srv = read('setup-server/server.js');
  assert.ok(!srv.includes('OPENCLAW_STATE'), 'setup-server should not reference OPENCLAW_STATE');
  assert.ok(srv.includes('ZEROCLAW_STATE'), 'setup-server should reference ZEROCLAW_STATE');
});

test('setup-server uses GATEWAY_TOKEN not OPENCLAW_GATEWAY_TOKEN', () => {
  const srv = read('setup-server/server.js');
  assert.ok(!srv.includes('OPENCLAW_GATEWAY_TOKEN'), 'setup-server should not use OPENCLAW_GATEWAY_TOKEN');
});

// ─── 13. Security: sensitive dirs ───────────────────────────────────────────

test('Dockerfile does not install git in final image', () => {
  const df = read('Dockerfile');
  // Git was needed for openclaw/node-llama-cpp, should not be in final image
  const runtimeSection = df.split('FROM node:22-slim AS runtime')[1] || '';
  assert.ok(!runtimeSection.includes('apt-get install') || !runtimeSection.includes(' git'),
    'Runtime image should not install git');
});

test('Dockerfile uses read_only tmpfs for security', () => {
  // This is a docker-compose concern, but verify compose has it
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('read_only: true'));
  assert.ok(dc.includes('no-new-privileges'));
});
