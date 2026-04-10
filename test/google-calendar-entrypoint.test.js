// test/google-calendar-entrypoint.test.js
// RED phase — Tests for Google Calendar entrypoint logic (env var export, skill sync).
// Run with: node --test test/google-calendar-entrypoint.test.js
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(prefix = 'limbo-gcal-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function runNodeInject(script, cfgPath, envOverrides = {}) {
  execFileSync(process.execPath, ['-e', script, cfgPath], {
    env: { ...process.env, ...envOverrides },
  });
}

// The entrypoint.sh Google Calendar injection script (extracted for testing).
// This is the exact node -e script that entrypoint.sh will use.
const GOOGLE_CALENDAR_SCRIPT = `
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const stateDir = process.env.OPENCLAW_STATE_DIR || '/home/limbo/.openclaw';
  cfg.mcp = cfg.mcp || {};
  cfg.mcp.servers = cfg.mcp.servers || {};
  cfg.mcp.servers["google-calendar"] = {
    command: "node",
    args: ["/app/mcp-server/index.js"],
    env: {
      GOOGLE_CALENDAR_ENABLED: "true",
      GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: stateDir + "/secrets/google_calendar_credentials.json",
      GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: "file"
    }
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
`;

function writeBaseConfig(dir, extra = {}) {
  const base = {
    gateway: { mode: 'local', port: 18789, auth: { mode: 'token', token: '' } },
    channels: {},
    mcp: {
      servers: {
        'limbo-vault': {
          command: 'node',
          args: ['/app/mcp-server/index.js'],
          env: { VAULT_PATH: '/data/vault', DB_PATH: '/data/db' },
        },
      },
    },
    ...extra,
  };
  const p = path.join(dir, `cfg-${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(base, null, 2));
  return p;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Google Calendar config injection', () => {
  let tmp;
  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  test('GOOGLE_CALENDAR_ENABLED=true injects google-calendar into MCP servers', () => {
    const cfgPath = writeBaseConfig(tmp.dir);
    runNodeInject(GOOGLE_CALENDAR_SCRIPT, cfgPath, {
      OPENCLAW_STATE_DIR: '/home/limbo/.openclaw',
    });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(cfg.mcp.servers['google-calendar'], 'google-calendar MCP server should exist');
    assert.equal(cfg.mcp.servers['google-calendar'].env.GOOGLE_CALENDAR_ENABLED, 'true');
    assert.equal(cfg.mcp.servers['google-calendar'].env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND, 'file');
  });

  test('injection preserves existing limbo-vault MCP server', () => {
    const cfgPath = writeBaseConfig(tmp.dir);
    runNodeInject(GOOGLE_CALENDAR_SCRIPT, cfgPath, {
      OPENCLAW_STATE_DIR: '/home/limbo/.openclaw',
    });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(cfg.mcp.servers['limbo-vault'], 'limbo-vault should still exist');
    assert.equal(cfg.mcp.servers['limbo-vault'].env.VAULT_PATH, '/data/vault');
  });

  test('credentials file path uses OPENCLAW_STATE_DIR', () => {
    const cfgPath = writeBaseConfig(tmp.dir);
    const customDir = '/custom/state/dir';
    runNodeInject(GOOGLE_CALENDAR_SCRIPT, cfgPath, {
      OPENCLAW_STATE_DIR: customDir,
    });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(
      cfg.mcp.servers['google-calendar'].env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE,
      `${customDir}/secrets/google_calendar_credentials.json`,
    );
  });
});

describe('Google Calendar skill conditional sync', () => {
  let tmp;
  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  // Simulate the entrypoint skill sync logic in JS
  function syncSkills(skillsSourceDir, workspaceDir, googleCalendarEnabled) {
    const skillsDest = path.join(workspaceDir, 'skills');
    fs.mkdirSync(skillsDest, { recursive: true });

    const entries = fs.readdirSync(skillsSourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;

      // Feature-gated: skip google-calendar if not enabled
      if (skillName === 'google-calendar' && googleCalendarEnabled !== 'true') continue;

      const destDir = path.join(skillsDest, skillName);
      fs.mkdirSync(destDir, { recursive: true });
      const files = fs.readdirSync(path.join(skillsSourceDir, skillName));
      for (const f of files) {
        fs.copyFileSync(
          path.join(skillsSourceDir, skillName, f),
          path.join(destDir, f),
        );
      }
    }
  }

  test('skill NOT copied when GOOGLE_CALENDAR_ENABLED is not true', () => {
    const src = path.join(tmp.dir, 'src-skills');
    const ws = path.join(tmp.dir, 'ws1');
    fs.mkdirSync(path.join(src, 'retrieve-file'), { recursive: true });
    fs.mkdirSync(path.join(src, 'google-calendar'), { recursive: true });
    fs.writeFileSync(path.join(src, 'retrieve-file', 'SKILL.md'), '# Retrieve');
    fs.writeFileSync(path.join(src, 'google-calendar', 'SKILL.md'), '# Calendar');

    syncSkills(src, ws, 'false');

    assert.ok(fs.existsSync(path.join(ws, 'skills', 'retrieve-file', 'SKILL.md')), 'retrieve-file should be synced');
    assert.ok(!fs.existsSync(path.join(ws, 'skills', 'google-calendar')), 'google-calendar should NOT be synced');
  });

  test('skill IS copied when GOOGLE_CALENDAR_ENABLED=true', () => {
    const src = path.join(tmp.dir, 'src-skills2');
    const ws = path.join(tmp.dir, 'ws2');
    fs.mkdirSync(path.join(src, 'retrieve-file'), { recursive: true });
    fs.mkdirSync(path.join(src, 'google-calendar'), { recursive: true });
    fs.writeFileSync(path.join(src, 'retrieve-file', 'SKILL.md'), '# Retrieve');
    fs.writeFileSync(path.join(src, 'google-calendar', 'SKILL.md'), '# Calendar');

    syncSkills(src, ws, 'true');

    assert.ok(fs.existsSync(path.join(ws, 'skills', 'retrieve-file', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(ws, 'skills', 'google-calendar', 'SKILL.md')), 'google-calendar should be synced');
  });
});
