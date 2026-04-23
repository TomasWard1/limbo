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

test('template uses profile "minimal" (not "full")', () => {
  const cfg = renderTemplate();
  assert.equal(cfg.tools.profile, 'minimal',
    'profile:full exposes ~40 native tools and confuses the model. Use minimal.');
});

// OpenClaw's `allow: []` + `profile: minimal` does NOT exclude exec/process —
// in practice an empty allow behaves as "allow everything", and profile:minimal
// only *adds* session_status to the base set. The only reliable way to block
// native tools is an explicit group-level deny. We observed Sonnet calling
// the native `exec` tool (with `echo "vault_search"`) because exec was visible.
// Always block every native group — MCP tools are registered separately and
// are not affected by these deny entries.
const REQUIRED_DENY_GROUPS = [
  'group:fs',          // read/write/edit/apply_patch — vault is the only persistence
  'group:runtime',     // exec/process/code_execution — Limbo is not a shell
  'group:web',         // only re-enabled by regen script when WEB_SEARCH_ENABLED=true
  'group:ui',          // browser/canvas — not a UI agent
  'group:sessions',    // sessions_* + session_status — single-session memory agent
  'group:memory',      // memory_search/memory_get — duplicates vault_*
  'group:messaging',   // native message tool — channels auto-deliver replies
  'group:automation',  // native cron + gateway — duplicate + self-reconfig risk
  'group:agents',      // agents_list — single-agent setup
  'group:nodes',       // nodes — no paired devices
  'group:media',       // image_generate/video_generate/tts — vision is in the model
];

test('template denies every native tool group (profile:minimal alone is not sufficient)', () => {
  const cfg = renderTemplate();
  assert.ok(Array.isArray(cfg.tools.deny), 'tools.deny must be an array');
  for (const g of REQUIRED_DENY_GROUPS) {
    assert.ok(cfg.tools.deny.includes(g),
      `tools.deny must include ${g} — otherwise tools in that group leak through profile:minimal and the agent sees (and calls) them`);
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
