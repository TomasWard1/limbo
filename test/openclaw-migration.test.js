/**
 * Integration tests for the ZeroClaw → OpenClaw migration.
 *
 * Validates that all config files, templates, and code references
 * are consistent after migrating to OpenClaw. These tests run without
 * Docker and verify structural correctness only.
 *
 * Run: node --test test/openclaw-migration.test.js
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

// ─── 1. Old ZeroClaw artifacts are removed ──────────────────────────────────

test('config.toml.template is deleted', () => {
  assert.ok(!exists('config.toml.template'), 'config.toml.template should not exist');
});

test('build-zeroclaw.sh is deleted', () => {
  assert.ok(!exists('scripts/build-zeroclaw.sh'), 'scripts/build-zeroclaw.sh should not exist');
});

test('agents/ directory is deleted (Paperclip stale content)', () => {
  assert.ok(!exists('agents'), 'agents/ directory should not exist');
});

// ─── 2. New OpenClaw config template exists and is valid JSON ───────────────

test('openclaw.json.template exists', () => {
  assert.ok(exists('openclaw.json.template'));
});

test('openclaw.json.template is valid JSON after envsubst simulation', () => {
  let json = read('openclaw.json.template');
  // Simulate envsubst by replacing template vars with dummy values
  json = json.replace(/\$\{MODEL_PROVIDER\}/g, 'anthropic');
  json = json.replace(/\$\{MODEL_NAME\}/g, 'claude-opus-4-6');
  json = json.replace(/\$\{LIMBO_PORT\}/g, '18789');
  json = json.replace(/\$\{RUNTIME_REASONING_EFFORT\}/g, 'medium');
  json = json.replace(/\$\{OPENCLAW_STATE_DIR\}/g, '/home/limbo/.openclaw');
  const cfg = JSON.parse(json);
  assert.ok(cfg.gateway, 'Must have gateway section');
  assert.ok(cfg.agents, 'Must have agents section');
  assert.ok(cfg.mcp, 'Must have mcp section');
  assert.ok(cfg.cron, 'Must have cron section');
});

test('openclaw.json.template uses envsubst variables', () => {
  const json = read('openclaw.json.template');
  const vars = ['${MODEL_PROVIDER}', '${MODEL_NAME}', '${LIMBO_PORT}', '${OPENCLAW_STATE_DIR}'];
  for (const v of vars) {
    assert.ok(json.includes(v), `Missing envsubst variable: ${v}`);
  }
});

test('openclaw.json.template registers limbo-vault MCP server', () => {
  const json = read('openclaw.json.template');
  assert.ok(json.includes('limbo-vault'));
  assert.ok(json.includes('/app/mcp-server/index.js'));
  assert.ok(json.includes('OPENCLAW_STATE_DIR'));
});

// Regression: manual allowlist had invalid tool names (cron, sessions)
test('openclaw.json.template uses tool profile instead of manual allowlist', () => {
  const json = read('openclaw.json.template');
  assert.ok(json.includes('"profile"'), 'Should use tools.profile');
  assert.ok(!json.includes('"cron"') || !json.includes('"allow"'),
    'Should not have manual allowlist with invalid tool names');
});

test('openclaw.json.template has sandbox off', () => {
  const json = read('openclaw.json.template');
  assert.ok(json.includes('"off"'), 'Sandbox should be set to off');
});

// Regression: template used invalid keys (identity, reasoning_effort, bind: "0.0.0.0")
test('openclaw.json.template does NOT use invalid OpenClaw config keys', () => {
  const json = read('openclaw.json.template');
  assert.ok(!json.includes('"identity"'), 'identity is not a valid OpenClaw top-level key');
  assert.ok(!json.includes('"reasoning_effort"'), 'reasoning_effort is not valid — use thinkingDefault');
});

// Regression: entrypoint injected "transcription" and "webSearch" as top-level keys
// NOTE: the inline injection blocks moved from entrypoint.sh into
// scripts/regen-openclaw-config.sh (shared by entrypoint boot and post-wizard
// hot reload). These regression checks now assert against the regen script.
test('regen script does NOT inject invalid top-level config keys', () => {
  const ep = read('scripts/regen-openclaw-config.sh');
  assert.ok(!ep.includes('cfg.transcription'), 'Must not inject transcription as top-level key');
  assert.ok(!ep.includes('cfg.webSearch'), 'Must not inject webSearch as top-level key');
});

test('regen script injects web search under tools.web.search', () => {
  const ep = read('scripts/regen-openclaw-config.sh');
  assert.ok(ep.includes('tools.web.search') || ep.includes("cfg.tools.web"),
    'Web search config must go under tools.web.search, not top-level webSearch');
});

test('openclaw.json.template uses thinkingDefault for reasoning effort', () => {
  const json = read('openclaw.json.template');
  assert.ok(json.includes('"thinkingDefault"'), 'Must use thinkingDefault (not reasoning_effort)');
});

test('openclaw.json.template gateway.bind uses valid enum value', () => {
  let json = read('openclaw.json.template');
  json = json.replace(/\$\{LIMBO_PORT\}/g, '18789');
  json = json.replace(/\$\{MODEL_PROVIDER\}/g, 'anthropic');
  json = json.replace(/\$\{MODEL_NAME\}/g, 'claude-opus-4-6');
  json = json.replace(/\$\{RUNTIME_REASONING_EFFORT\}/g, 'medium');
  json = json.replace(/\$\{OPENCLAW_STATE_DIR\}/g, '/home/limbo/.openclaw');
  const cfg = JSON.parse(json);
  const validBindValues = ['auto', 'lan', 'loopback', 'custom', 'tailnet'];
  assert.ok(validBindValues.includes(cfg.gateway.bind),
    `gateway.bind must be one of ${validBindValues.join(', ')}, got "${cfg.gateway.bind}"`);
});

// ─── 3. Entrypoint uses OpenClaw ────────────────────────────────────────────

test('entrypoint.sh hands off to the wizard supervisor (which launches OpenClaw)', () => {
  const ep = read('scripts/entrypoint.sh');
  // Old: exec openclaw gateway. New: exec node /app/scripts/supervisor.js,
  // which in turn spawns openclaw as a child so that the control plane can
  // keep running alongside.
  assert.ok(ep.includes('exec node /app/scripts/supervisor.js'),
    'entrypoint must hand off to the supervisor');
  const supervisor = read('scripts/supervisor.js');
  assert.ok(supervisor.includes("OPENCLAW_BIN") && supervisor.includes("'gateway'"),
    'supervisor script must launch the openclaw gateway as its managed child');
});

test('entrypoint.sh uses OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('OPENCLAW_STATE_DIR'));
  assert.ok(ep.includes('OPENCLAW_CONFIG_PATH'));
});

test('entrypoint.sh does not reference zeroclaw binary', () => {
  const ep = read('scripts/entrypoint.sh');
  const lines = ep.split('\n').filter(l => !l.trim().startsWith('#'));
  const nonCommentContent = lines.join('\n');
  assert.ok(!nonCommentContent.includes('zeroclaw '), 'Entrypoint should not invoke zeroclaw binary');
  assert.ok(!nonCommentContent.includes('ZEROCLAW_'), 'Entrypoint should not use ZEROCLAW_ env vars');
});

test('regen script renders openclaw.json from template via envsubst', () => {
  const regen = read('scripts/regen-openclaw-config.sh');
  assert.ok(regen.includes('openclaw.json.template') || regen.includes('OPENCLAW_CONFIG_TEMPLATE'));
  assert.ok(regen.includes('envsubst'));
});

test('regen script uses node -e for conditional JSON config injection', () => {
  const regen = read('scripts/regen-openclaw-config.sh');
  assert.ok(regen.includes('node -e'), 'Should use node for safe JSON manipulation');
  assert.ok(regen.includes('channels.telegram'), 'Should inject telegram config');
});

// ─── 4. Dockerfile references OpenClaw, not ZeroClaw ────────────────────────

test('Dockerfile installs openclaw via npm', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('npm install -g') && df.includes('openclaw'), 'Dockerfile must install openclaw globally');
});

test('Dockerfile does not reference zeroclaw binary', () => {
  const df = read('Dockerfile');
  assert.ok(!df.includes('COPY --from=zeroclaw'), 'Should not copy zeroclaw binary');
  assert.ok(!df.includes('ZEROCLAW_IMAGE'), 'Should not have ZEROCLAW_IMAGE build arg');
});

test('Dockerfile creates .openclaw directory', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('.openclaw'), 'Dockerfile must pre-create .openclaw directory');
});

test('Dockerfile copies openclaw.json.template', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('openclaw.json.template'));
});

// ─── 5. docker-compose.yml uses OpenClaw paths ─────────────────────────────

test('docker-compose.yml uses .openclaw container path', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('.openclaw'), 'Bind mount must target .openclaw directory');
  assert.ok(!dc.includes('.zeroclaw'), 'Must not reference .zeroclaw');
});

test('docker-compose.yml has healthcheck using /healthz', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('healthz'), 'Healthcheck should use /healthz endpoint');
});

test('docker-compose.yml has init: true', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('init: true'), 'Should use init for signal handling');
});

// ─── 6. docker-compose.test.yml has memory limits ──────────────────────────

test('docker-compose.test.yml has 1GB memory limit', () => {
  const dc = read('docker-compose.test.yml');
  assert.ok(dc.includes('mem_limit') || dc.includes('memory'), 'Test compose should have memory limits');
});

// ─── 7. Setup server uses OpenClaw paths ────────────────────────────────────

test('setup-server uses OPENCLAW_STATE not ZEROCLAW_STATE', () => {
  const srv = read('setup-server/server.js');
  assert.ok(srv.includes('OPENCLAW_STATE'), 'setup-server should reference OPENCLAW_STATE');
  assert.ok(!srv.includes('ZEROCLAW_STATE'), 'setup-server should not reference ZEROCLAW_STATE');
});

// Regression: auth-profiles.json was written to ~/.openclaw/ but OpenClaw reads
// from ~/.openclaw/agents/main/agent/auth-profiles.json (per-agent path)
test('setup-server writes auth-profiles to per-agent path', () => {
  const srv = read('setup-server/server.js');
  assert.ok(srv.includes("agents', 'main', 'agent'") || srv.includes('agents/main/agent'),
    'Auth profiles must be written to agents/main/agent/ (per-agent path)');
});

// Regression: auth profile used ZeroClaw field names (schema_version, kind,
// access_token) instead of OpenClaw's (version, type, access)
test('setup-server buildCodexAuthProfile uses OpenClaw field names', () => {
  const srv = read('setup-server/server.js');
  // Must use OpenClaw fields
  assert.ok(srv.includes("version: 1"), 'Must use version (not schema_version)');
  assert.ok(srv.includes("type: 'oauth'"), 'Must use type (not kind)');
  // Must NOT use ZeroClaw fields
  assert.ok(!srv.includes('schema_version'), 'Must not use schema_version');
  assert.ok(!srv.includes("kind: 'oauth'"), 'Must not use kind');
  // access_token/refresh_token appear in processOAuthTokens (reading OpenAI's OAuth response)
  // but must NOT appear in buildCodexAuthProfile (writing our profile store)
  const buildFnMatch = srv.match(/function buildCodexAuthProfile[\s\S]*?^}/m);
  if (buildFnMatch) {
    assert.ok(!buildFnMatch[0].includes('access_token'), 'buildCodexAuthProfile must not use access_token');
    assert.ok(!buildFnMatch[0].includes('refresh_token'), 'buildCodexAuthProfile must not use refresh_token');
  }
  assert.ok(!srv.includes('active_profiles'), 'Must not use active_profiles');
});

// Regression: libssl3 missing caused ACP runtime probe failure
test('Dockerfile includes libssl3 for OpenClaw ACP runtime', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('libssl3'), 'Dockerfile must install libssl3 for codex-acp');
});

// Regression: OpenClaw's pinned-write-helper spawns python3 for safe atomic writes.
// Without python3, session-memory hook fails with misleading SafeOpenError.
test('Dockerfile includes python3 for OpenClaw pinned-write-helper', () => {
  const df = read('Dockerfile');
  assert.ok(df.includes('python3'), 'Dockerfile must install python3 for OpenClaw safe file writes');
});

// ─── 8. MCP server uses OpenClaw env vars ───────────────────────────────────

test('mcp-server workspace.js uses OPENCLAW_ env vars', () => {
  const ws = read('mcp-server/tools/workspace.js');
  assert.ok(ws.includes('OPENCLAW_WORKSPACE_DIR'), 'Should use OPENCLAW_WORKSPACE_DIR');
  assert.ok(ws.includes('OPENCLAW_STATE_DIR'), 'Should use OPENCLAW_STATE_DIR');
  assert.ok(!ws.includes('ZEROCLAW_'), 'Should not reference ZEROCLAW_');
});

// ─── 9. Workspace docs updated ─────────────────────────────────────────────

test('TOOLS.md does not reference zeroclaw', () => {
  const tools = read('workspace/system/TOOLS.md');
  assert.ok(!tools.toLowerCase().includes('zeroclaw'), 'TOOLS.md should not reference ZeroClaw');
});

test('AGENTS.md does not reference zeroclaw', () => {
  const agents = read('workspace/system/AGENTS.md');
  assert.ok(!agents.toLowerCase().includes('zeroclaw'), 'AGENTS.md should not reference ZeroClaw');
});

test('IDENTITY.md does not reference zeroclaw', () => {
  const id = read('workspace/system/IDENTITY.md');
  assert.ok(!id.toLowerCase().includes('zeroclaw'), 'IDENTITY.md should not reference ZeroClaw');
});

// ─── 10. USER.md template is still valid ────────────────────────────────────

test('USER.md template uses plain envsubst variables', () => {
  const template = read('workspace/templates/USER.md.template');
  assert.ok(template.includes('$USER_NAME'));
  assert.ok(template.includes('$USER_TIMEZONE'));
  assert.ok(template.includes('$USER_LANGUAGE'));
});

test('entrypoint.sh defaults USER.md fields before envsubst', () => {
  const ep = read('scripts/entrypoint.sh');
  assert.ok(ep.includes('USER_NAME="${USER_NAME:-User}"'));
  assert.ok(ep.includes('USER_TIMEZONE="${USER_TIMEZONE:-}"'));
  assert.ok(ep.includes('USER_LANGUAGE="${USER_LANGUAGE:-English}"'));
});

// ─── 11. Migration infrastructure intact ────────────────────────────────────

test('migration index exists', () => {
  assert.ok(exists('migrations/index.js'));
});

// ─── 12. Security hardening preserved ───────────────────────────────────────

test('docker-compose.yml has security hardening', () => {
  const dc = read('docker-compose.yml');
  assert.ok(dc.includes('read_only: true'));
  assert.ok(dc.includes('no-new-privileges'));
  assert.ok(dc.includes('cap_drop'));
});
