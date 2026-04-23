/**
 * Tool surface reduction — hardens the native OpenClaw tool surface so the
 * agent sees only what Limbo's use case needs (MCP vault/workspace/cron/
 * calendar plus session_status). Reduces model confusion from overlapping
 * tools and closes the gateway/cron/fs self-mutation backdoors.
 *
 * Design:
 *   - tools.profile = "minimal"      → base allowlist = { session_status }
 *   - tools.allow   = [session_status]  (explicit, redundant-by-design)
 *   - tools.deny    = [gateway, cron]  → belt-and-suspenders for the two
 *                                        native tools that are most dangerous
 *                                        (self-reconfig) or most redundant
 *                                        (cron duplicates our MCP cron_*).
 *   - regen script appends web_search + web_fetch to tools.allow when
 *     WEB_SEARCH_ENABLED=true — so the web toggle still works end-to-end
 *     now that the base profile is minimal.
 *
 * MCP tools (vault_*, workspace_*, cron_*, calendar_*, update_instance) are
 * exposed via mcp.servers.limbo-vault and are NOT affected by tools.profile
 * — they always appear to the agent regardless of native tool config.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function renderTemplate() {
  let json = read('openclaw.json.template');
  json = json.replace(/\$\{LIMBO_PORT\}/g, '18789');
  json = json.replace(/\$\{MODEL_PROVIDER\}/g, 'anthropic');
  json = json.replace(/\$\{MODEL_NAME\}/g, 'claude-sonnet-4-6');
  json = json.replace(/\$\{RUNTIME_REASONING_EFFORT\}/g, 'medium');
  json = json.replace(/\$\{OPENCLAW_STATE_DIR\}/g, '/home/limbo/.openclaw');
  return JSON.parse(json);
}

test('template uses profile "full" with an explicit per-tool deny list', () => {
  const cfg = renderTemplate();
  assert.equal(cfg.tools.profile, 'full',
    'Template uses profile:full because MCP tools need to coexist with a curated native subset. Specific tools are silenced via tools.deny.');
});

// The tool-surface-reduction work collapsed group-level denies into an
// explicit per-tool list so we keep profile:full (needed for MCP tooling to
// register cleanly) while still blocking the tools that confused the agent.
// This list mirrors what ships in openclaw.json.template — update it here
// when you deliberately re-enable or disable a native tool.
const REQUIRED_DENY_TOOLS = [
  'gateway',
  'nodes',
  'agents_list',
  'image_generate',
  'video_generate',
  'music_generate',
  'tts',
  'browser',
  'canvas',
  'cron',
  'memory_search',
  'memory_get',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
  'message',
];

test('template denies every native tool that confuses the agent', () => {
  const cfg = renderTemplate();
  assert.ok(Array.isArray(cfg.tools.deny), 'tools.deny must be an array');
  for (const t of REQUIRED_DENY_TOOLS) {
    assert.ok(cfg.tools.deny.includes(t),
      `tools.deny must include ${t} — otherwise it leaks through profile:full and the agent sees (and calls) it`);
  }
});

test('template raises bootstrap char limits so TOOLS.md/AGENTS.md are not truncated', () => {
  const cfg = renderTemplate();
  const defaults = cfg.agents && cfg.agents.defaults;
  assert.ok(defaults, 'agents.defaults must exist');
  assert.ok((defaults.bootstrapMaxChars || 0) >= 20000,
    'TOOLS.md is ~12KB today and can grow — keep per-file limit generous to prevent truncation warnings that confuse the agent');
  assert.ok((defaults.bootstrapTotalMaxChars || 0) >= 100000,
    'Total bootstrap budget must cover AGENTS.md + TOOLS.md + IDENTITY.md + SOUL.md + USER.md + skill headers');
});

test('template does NOT include message in allow (replies are channel-routed automatically)', () => {
  const cfg = renderTemplate();
  const allow = cfg.tools.allow || [];
  assert.ok(!allow.includes('message'),
    'OpenClaw routes replies back to the inbound channel without the message tool');
});

test('template does NOT include media tools in allow (vision is in the model, not a tool)', () => {
  const cfg = renderTemplate();
  const allow = cfg.tools.allow || [];
  for (const t of ['image', 'image_generate', 'video_generate', 'music_generate', 'tts']) {
    assert.ok(!allow.includes(t), `${t} should stay behind profile:minimal`);
  }
});

test('regen script adds web_search + web_fetch to tools.allow when WEB_SEARCH_ENABLED=true', () => {
  const regen = read('scripts/regen-openclaw-config.sh');
  assert.ok(regen.includes('web_search'),
    'Regen script must push web_search into tools.allow when web search is enabled — otherwise profile:minimal strips it');
  assert.ok(regen.includes('web_fetch'),
    'web_fetch complements web_search for fetching page content');
});
