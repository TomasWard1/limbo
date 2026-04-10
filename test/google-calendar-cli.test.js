// test/google-calendar-cli.test.js
// RED phase — Tests for `limbo connect-calendar` CLI command.
// Run with: node --test test/google-calendar-cli.test.js
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(prefix = 'limbo-cli-gcal-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeEnvFile(dir, vars) {
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n') + '\n';
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  return envPath;
}

function parseEnvFile(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  const vars = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('connect-calendar env manipulation', () => {
  let tmp;
  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  test('writes CONNECT_CALENDAR_MODE=true preserving existing vars', () => {
    const envPath = writeEnvFile(tmp.dir, {
      MODEL_PROVIDER: 'anthropic',
      MODEL_NAME: 'claude-opus-4-6',
      TELEGRAM_ENABLED: 'true',
      VOICE_ENABLED: 'false',
    });

    // Simulate what cmdConnectCalendar does: read, strip mode, append mode
    const content = fs.readFileSync(envPath, 'utf8');
    const cleaned = content.replace(/^CONNECT_CALENDAR_MODE=.*\n?/gm, '');
    fs.writeFileSync(envPath, cleaned + 'CONNECT_CALENDAR_MODE=true\n', { mode: 0o600 });

    const vars = parseEnvFile(envPath);
    assert.equal(vars.CONNECT_CALENDAR_MODE, 'true');
    assert.equal(vars.MODEL_PROVIDER, 'anthropic');
    assert.equal(vars.TELEGRAM_ENABLED, 'true');
    assert.equal(vars.VOICE_ENABLED, 'false');
  });

  test('cleans CONNECT_CALENDAR_MODE after completion', () => {
    const envPath = writeEnvFile(tmp.dir, {
      MODEL_PROVIDER: 'anthropic',
      CONNECT_CALENDAR_MODE: 'true',
      GOOGLE_CALENDAR_ENABLED: 'true',
    });

    // Simulate cleanup
    const content = fs.readFileSync(envPath, 'utf8');
    const cleaned = content.replace(/^CONNECT_CALENDAR_MODE=.*\n?/gm, '');
    fs.writeFileSync(envPath, cleaned, { mode: 0o600 });

    const vars = parseEnvFile(envPath);
    assert.ok(!vars.CONNECT_CALENDAR_MODE, 'CONNECT_CALENDAR_MODE should be removed');
    assert.equal(vars.MODEL_PROVIDER, 'anthropic');
    assert.equal(vars.GOOGLE_CALENDAR_ENABLED, 'true');
  });
});

describe('CLI command registration', () => {
  test('cli.js contains connect-calendar command', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    assert.ok(
      cliSrc.includes('connect-calendar'),
      'cli.js should register connect-calendar command',
    );
  });

  test('cli.js has cmdConnectCalendar function', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    assert.ok(
      cliSrc.includes('cmdConnectCalendar') || cliSrc.includes('connectCalendar'),
      'cli.js should have a connect-calendar handler function',
    );
  });

  test('help text includes connect-calendar', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    // The help section lists all commands
    assert.ok(
      cliSrc.includes('connect-calendar') && cliSrc.includes('Connect Google Calendar'),
      'Help text should describe connect-calendar command',
    );
  });
});
