// test/cloud-cmd.test.js
// Tests for `limbo cloud activate/deactivate/status`.
// Uses static source analysis (same pattern as switch-brain-cli.test.js) plus
// a handful of runtime tests against a temp LIMBO_HOME for the status command.
//
// Run with: node --test test/cloud-cmd.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');
const CLI_SRC = fs.readFileSync(CLI_PATH, 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpHome(prefix = 'limbo-cloud-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  return { dir, configDir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeEnvFile(configDir, vars) {
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(path.join(configDir, '.env'), content);
}

// Run `node cli.js cloud status` with a custom LIMBO_HOME, capture stdout.
function runCloudStatus(limboHome) {
  return execFileSync(process.execPath, [CLI_PATH, 'cloud', 'status'], {
    env: { ...process.env, LIMBO_HOME: limboHome },
    encoding: 'utf8',
  });
}

// Extract a named function body by brace counting.
function extractFn(src, fnSignature) {
  const start = src.indexOf(fnSignature);
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
  return src.slice(bodyStart);
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('cloud constants', () => {
  test('PROVISION_API_URL is defined', () => {
    assert.ok(
      /PROVISION_API_URL\s*=\s*['"]https:\/\/api\.heylimbo\.com['"]/.test(CLI_SRC),
      'cli.js must define PROVISION_API_URL pointing at api.heylimbo.com'
    );
  });

  test('PROVISION_SECRET is defined', () => {
    assert.ok(
      /PROVISION_SECRET\s*=\s*['"]limbo-provision-2026['"]/.test(CLI_SRC),
      'cli.js must define PROVISION_SECRET'
    );
  });
});

// ── Command dispatch ──────────────────────────────────────────────────────────

describe('command dispatch', () => {
  test("switch statement contains 'cloud' case", () => {
    assert.ok(
      /case 'cloud'/.test(CLI_SRC),
      "cli.js switch must handle 'cloud'"
    );
  });

  test('cloud case dispatches to cmdCloudActivate', () => {
    assert.ok(
      /cmdCloudActivate/.test(CLI_SRC),
      'cli.js must reference cmdCloudActivate'
    );
  });

  test('cloud case dispatches to cmdCloudDeactivate', () => {
    assert.ok(
      /cmdCloudDeactivate/.test(CLI_SRC),
      'cli.js must reference cmdCloudDeactivate'
    );
  });

  test('cloud case dispatches to cmdCloudStatus', () => {
    assert.ok(
      /cmdCloudStatus/.test(CLI_SRC),
      'cli.js must reference cmdCloudStatus'
    );
  });
});

// ── cmdCloudActivate guards ───────────────────────────────────────────────────

describe('cmdCloudActivate source guards', () => {
  const body = extractFn(CLI_SRC, 'async function cmdCloudActivate(');

  test('checks MODEL_PROVIDER before proceeding', () => {
    assert.ok(
      /MODEL_PROVIDER/.test(body),
      'cmdCloudActivate must check MODEL_PROVIDER (instance must be configured first)'
    );
  });

  test('checks LIMBO_PUBLIC_URL for already-activated guard', () => {
    assert.ok(
      /LIMBO_PUBLIC_URL/.test(body),
      'cmdCloudActivate must check LIMBO_PUBLIC_URL to detect already-activated state'
    );
  });

  test('calls the provisioning API', () => {
    assert.ok(
      /PROVISION_API_URL/.test(body),
      'cmdCloudActivate must call the provisioning API'
    );
  });

  test('saves LIMBO_PUBLIC_URL to .env', () => {
    assert.ok(
      /LIMBO_PUBLIC_URL=/.test(body),
      'cmdCloudActivate must write LIMBO_PUBLIC_URL to .env'
    );
  });

  test('saves LIMBO_INSTANCE_ID to .env', () => {
    assert.ok(
      /LIMBO_INSTANCE_ID=/.test(body),
      'cmdCloudActivate must write LIMBO_INSTANCE_ID to .env'
    );
  });

  test('regenerates compose file', () => {
    assert.ok(
      /ensureComposeFile/.test(body),
      'cmdCloudActivate must call ensureComposeFile to pick up the port 80 mapping'
    );
  });

  test('restarts container', () => {
    assert.ok(
      /runDockerCompose/.test(body),
      'cmdCloudActivate must call runDockerCompose to restart the container'
    );
  });
});

// ── cmdCloudDeactivate guards ─────────────────────────────────────────────────

describe('cmdCloudDeactivate source guards', () => {
  const body = extractFn(CLI_SRC, 'async function cmdCloudDeactivate(');

  test('checks LIMBO_INSTANCE_ID before proceeding', () => {
    assert.ok(
      /LIMBO_INSTANCE_ID/.test(body),
      'cmdCloudDeactivate must check LIMBO_INSTANCE_ID (must be activated first)'
    );
  });

  test('calls DELETE on the provisioning API', () => {
    assert.ok(
      /DELETE/.test(body),
      'cmdCloudDeactivate must send a DELETE request to the provisioning API'
    );
  });

  test('removes LIMBO_PUBLIC_URL from .env', () => {
    assert.ok(
      /LIMBO_PUBLIC_URL/.test(body),
      'cmdCloudDeactivate must remove LIMBO_PUBLIC_URL from .env'
    );
  });

  test('removes LIMBO_INSTANCE_ID from .env', () => {
    assert.ok(
      /LIMBO_INSTANCE_ID/.test(body),
      'cmdCloudDeactivate must remove LIMBO_INSTANCE_ID from .env'
    );
  });

  test('regenerates compose file', () => {
    assert.ok(
      /ensureComposeFile/.test(body),
      'cmdCloudDeactivate must call ensureComposeFile after removing cloud config'
    );
  });

  test('restarts container', () => {
    assert.ok(
      /runDockerCompose/.test(body),
      'cmdCloudDeactivate must call runDockerCompose to restart the container'
    );
  });
});

// ── cmdCloudStatus runtime tests ──────────────────────────────────────────────

describe('cmdCloudStatus runtime', () => {
  test('shows active status when LIMBO_PUBLIC_URL is set', () => {
    const { dir, configDir, cleanup } = makeTmpHome();
    try {
      writeEnvFile(configDir, {
        MODEL_PROVIDER: 'anthropic',
        LIMBO_PUBLIC_URL: 'https://abc123.heylimbo.com',
        LIMBO_INSTANCE_ID: 'abc123',
      });
      const out = runCloudStatus(dir);
      // Strip ANSI escapes for comparison
      const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(plain.includes('active'), 'output should say active');
      assert.ok(plain.includes('abc123.heylimbo.com'), 'output should include the URL');
    } finally {
      cleanup();
    }
  });

  test('shows not-activated status when LIMBO_PUBLIC_URL is absent', () => {
    const { dir, configDir, cleanup } = makeTmpHome();
    try {
      writeEnvFile(configDir, { MODEL_PROVIDER: 'anthropic' });
      const out = runCloudStatus(dir);
      const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(plain.includes('not activated'), 'output should say not activated');
      assert.ok(plain.includes('limbo cloud activate'), 'output should suggest activate command');
    } finally {
      cleanup();
    }
  });

  test('shows not-activated when .env does not exist', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      // No .env written — parseEnvFile returns {}
      const out = runCloudStatus(dir);
      const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(plain.includes('not activated'));
    } finally {
      cleanup();
    }
  });
});

// ── Help text ─────────────────────────────────────────────────────────────────

describe('help text', () => {
  test('help mentions cloud activate', () => {
    assert.ok(
      /cloud activate/.test(CLI_SRC),
      'help text must mention cloud activate'
    );
  });

  test('help mentions cloud deactivate', () => {
    assert.ok(
      /cloud deactivate/.test(CLI_SRC),
      'help text must mention cloud deactivate'
    );
  });

  test('help mentions cloud status', () => {
    assert.ok(
      /cloud status/.test(CLI_SRC),
      'help text must mention cloud status'
    );
  });
});
