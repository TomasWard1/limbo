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

describe('connect-calendar CLI does not write CONNECT_CALENDAR_MODE to .env', () => {
  // Pre-refactor, the CLI wrote CONNECT_CALENDAR_MODE=true to .env, restarted
  // the container, and let entrypoint.sh dispatch to the setup-server. That
  // flow is gone: the CLI now talks to the wizard supervisor over a Unix
  // socket, and the spawner injects CONNECT_CALENDAR_MODE=true into the
  // setup-server child's env (not into the shared .env file).
  test('cli.js cmdConnectCalendar does not mutate .env with CONNECT_CALENDAR_MODE', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    // Grep the source for any write of CONNECT_CALENDAR_MODE=true. If this
    // ever comes back, the container restart path has regressed.
    assert.ok(
      !/CONNECT_CALENDAR_MODE=true/.test(cliSrc),
      'cli.js must not write CONNECT_CALENDAR_MODE to the shared .env file'
    );
  });

  test('spawner (lib/wizard-spawner.js) is the only writer of CONNECT_CALENDAR_MODE', () => {
    // Wizard-spawner injects CONNECT_CALENDAR_MODE=true into the child
    // process env when spawning a calendar wizard. That's the new interface.
    const spawnerSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'wizard-spawner.js'), 'utf8');
    assert.ok(
      /CONNECT_CALENDAR_MODE/.test(spawnerSrc),
      'wizard-spawner must still carry the env var — setup-server reads it to pick wizard mode'
    );
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
