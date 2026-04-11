// test/switch-brain-cli.test.js
// Regression tests for `limbo switch-brain` after the wizard-sidecar refactor.
// Pre-refactor, cmdSwitchBrain wrote SWITCH_BRAIN_MODE=true into .env, pulled
// the image, and force-recreated the container. That whole flow is gone: the
// CLI now talks to the wizard supervisor over the Unix socket and the
// spawner injects SWITCH_BRAIN_MODE=true into the setup-server child's env
// (not into the shared .env file).
//
// Run with: node --test test/switch-brain-cli.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractCmdSwitchBrain(src) {
  // Grab the body of async function cmdSwitchBrain() { ... } up to its
  // matching closing brace at the top level. Rough but sufficient for
  // string-level regression greps.
  const start = src.indexOf('async function cmdSwitchBrain(');
  if (start === -1) return '';
  // Find the function body by counting braces starting from the first `{`.
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
  return src.slice(bodyStart);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('switch-brain CLI does not write SWITCH_BRAIN_MODE to .env', () => {
  test('cli.js cmdSwitchBrain does not mutate .env with SWITCH_BRAIN_MODE', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    assert.ok(
      !/SWITCH_BRAIN_MODE=true/.test(cliSrc),
      'cli.js must not write SWITCH_BRAIN_MODE to the shared .env file'
    );
  });

  test('spawner (lib/wizard-spawner.js) is the only writer of SWITCH_BRAIN_MODE', () => {
    const spawnerSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'wizard-spawner.js'), 'utf8');
    assert.ok(
      /SWITCH_BRAIN_MODE/.test(spawnerSrc),
      'wizard-spawner must carry the env var — setup-server reads it to pick wizard mode'
    );
  });
});

describe('switch-brain CLI uses the control plane, not container restart', () => {
  test('cmdSwitchBrain does not force-recreate the container', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdSwitchBrain(cliSrc);
    assert.ok(body.length > 0, 'cmdSwitchBrain function body must be found');
    // Strip comments so a descriptive "no force-recreate" comment doesn't
    // fool the grep. We only want to flag actual code calls.
    const code = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/runDockerCompose[^)]*force-recreate/.test(code),
      'cmdSwitchBrain must not invoke `docker compose up --force-recreate`'
    );
    assert.ok(
      !code.includes('pullOrBuildImage('),
      'cmdSwitchBrain must not pull/build images — the container is already running'
    );
    assert.ok(
      !code.includes('extractWizardUrl('),
      'cmdSwitchBrain must not scrape logs for the wizard URL — the supervisor hands it back directly'
    );
  });

  test('cmdSwitchBrain uses createControlClient and requestWizard({feature: "switch-brain"})', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdSwitchBrain(cliSrc);
    assert.ok(
      body.includes("createControlClient"),
      'cmdSwitchBrain must use the control client'
    );
    assert.ok(
      /feature:\s*['"]switch-brain['"]/.test(body),
      'cmdSwitchBrain must request a wizard with feature: "switch-brain"'
    );
    assert.ok(
      body.includes('getWizard'),
      'cmdSwitchBrain must poll the session until terminal via getWizard'
    );
  });

  test('cmdSwitchBrain installs SIGINT cleanup for the wizard session', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdSwitchBrain(cliSrc);
    assert.ok(
      body.includes('installWizardCleanupHandlers'),
      'cmdSwitchBrain must install SIGINT/SIGTERM cleanup handlers so Ctrl+C cancels the session'
    );
    assert.ok(
      body.includes('cleanup.uninstall'),
      'cmdSwitchBrain must uninstall the cleanup handlers on normal completion'
    );
  });

  test('cmdSwitchBrain handles 409 with a helpful error message', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    const body = extractCmdSwitchBrain(cliSrc);
    assert.ok(
      /err\.status\s*===\s*409/.test(body),
      'cmdSwitchBrain must branch on 409 Conflict from the control plane'
    );
    assert.ok(
      body.includes('already active'),
      'cmdSwitchBrain must surface "already active" to the user'
    );
  });
});

describe('CLI command registration', () => {
  test('cli.js still registers switch-brain', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    assert.ok(cliSrc.includes('switch-brain'));
    assert.ok(cliSrc.includes('cmdSwitchBrain') || cliSrc.includes('switchBrain'));
  });

  test('help text still describes switch-brain', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
    assert.ok(cliSrc.includes('switch-brain') && cliSrc.includes('Change your AI provider'));
  });
});
