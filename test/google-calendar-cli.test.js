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

describe('connect-calendar CLI lifecycle management', () => {
  function extractCmdBody(src) {
    const start = src.indexOf('async function cmdConnectCalendar(');
    if (start === -1) return '';
    const bodyStart = src.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return src.slice(bodyStart, i + 1);
      }
    }
    return '';
  }

  test('cmdConnectCalendar installs SIGINT cleanup so Ctrl+C does not orphan the wizard', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdBody(cliSrc);
    assert.ok(body.length > 0, 'cmdConnectCalendar must be found');
    assert.ok(
      body.includes('installWizardCleanupHandlers'),
      'cmdConnectCalendar must install SIGINT/SIGTERM cleanup handlers'
    );
    assert.ok(
      body.includes('cleanup.uninstall'),
      'cmdConnectCalendar must uninstall the cleanup handlers on normal completion'
    );
  });

  test('cmdConnectCalendar uses requestWizardWithAutoCancel for stale session handling', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdBody(cliSrc);
    assert.ok(
      body.includes('requestWizardWithAutoCancel'),
      'cmdConnectCalendar must use requestWizardWithAutoCancel to auto-cancel stale sessions'
    );
    // The helper itself handles 409 → cancel → retry
    assert.ok(
      cliSrc.includes('cancelWizard(err.body.activeSessionId)'),
      'requestWizardWithAutoCancel must cancel the stale session on 409'
    );
  });
});

describe('installWizardCleanupHandlers helper', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');

  // Black box test: spawn a child Node process that loads the helper out
  // of cli.js source, wires a fake client, and signals itself. We assert
  // on the side-effect (a marker file the fake cancelWizard writes).

  function extractHelperSource() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const m = src.match(/function installWizardCleanupHandlers\([^]*?\n\}\n/);
    assert.ok(m, 'installWizardCleanupHandlers source must be findable in cli.js');
    return m[0];
  }

  test('SIGINT fires client.cancelWizard with the active session id', () => {
    const helperSrc = extractHelperSource();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-cleanup-'));
    const scriptPath = path.join(tmpDir, 'run.js');
    const resultPath = path.join(tmpDir, 'result.txt');
    const script = `
${helperSrc}
const fs = require('fs');
const client = {
  cancelWizard: (id) => { fs.writeFileSync(${JSON.stringify(resultPath)}, 'CANCELLED:' + id); return Promise.resolve(); },
};
installWizardCleanupHandlers(client, { id: 'sess-sigint-test' });
setImmediate(() => process.kill(process.pid, 'SIGINT'));
setInterval(() => {}, 1000);
`;
    fs.writeFileSync(scriptPath, script);
    try {
      spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 5000 });
      assert.ok(fs.existsSync(resultPath), 'result file not found — handler did not run');
      assert.equal(fs.readFileSync(resultPath, 'utf8'), 'CANCELLED:sess-sigint-test');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('uninstall removes the signal listener so cancel does NOT fire', () => {
    const helperSrc = extractHelperSource();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-cleanup-'));
    const scriptPath = path.join(tmpDir, 'run.js');
    const resultPath = path.join(tmpDir, 'result.txt');
    const script = `
${helperSrc}
const fs = require('fs');
const client = {
  cancelWizard: () => { fs.writeFileSync(${JSON.stringify(resultPath)}, 'CANCELLED'); return Promise.resolve(); },
};
const h = installWizardCleanupHandlers(client, { id: 'sess' });
h.uninstall();
setImmediate(() => process.kill(process.pid, 'SIGINT'));
setInterval(() => {}, 1000);
`;
    fs.writeFileSync(scriptPath, script);
    try {
      spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 5000 });
      assert.equal(fs.existsSync(resultPath), false, 'uninstalled handler must not fire cancel');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
