/**
 * RED PHASE tests — these test suspected bugs in the current code.
 * Each test documents what SHOULD be true but likely ISN'T.
 * Fix the code to make these pass, then move them to their proper suite.
 *
 * Run: node --test test/red-phase.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ─── BUG 1: CLI compose YAML missing init: true ────────────────────────────
// The static docker-compose.yml files all have `init: true` for proper signal
// handling with Node.js (zombie process reaping, SIGTERM forwarding).
// But the CLI dynamically generates compose YAML without it.
// OpenClaw is Node.js — without init, orphan child processes from tool exec
// accumulate as zombies and SIGTERM doesn't propagate cleanly.

describe('CLI compose must include init: true', () => {
  const cliSource = read('cli.js');

  // Extract all compose template strings (they're between backtick delimiters
  // and contain 'services:' as a marker)
  const composeBlocks = [];
  const backtickRegex = /`([^`]*services:[^`]*)`/gs;
  let match;
  while ((match = backtickRegex.exec(cliSource)) !== null) {
    composeBlocks.push(match[1]);
  }

  test('at least one compose template found in CLI source', () => {
    assert.ok(composeBlocks.length > 0, 'Should find compose template strings in cli.js');
  });

  test('standard compose template includes init: true', () => {
    const standard = composeBlocks.find(b => b.includes('services:') && !b.includes('squid'));
    assert.ok(standard, 'Should find standard (non-hardened) compose template');
    assert.ok(standard.includes('init: true'),
      'Standard compose template must include init: true for Node.js signal handling');
  });

  test('hardened compose template includes init: true', () => {
    const hardened = composeBlocks.find(b => b.includes('squid'));
    if (!hardened) return; // skip if no hardened template
    assert.ok(hardened.includes('init: true'),
      'Hardened compose template must include init: true for Node.js signal handling');
  });
});


// ─── BUG 2: Entrypoint doesn't create cron directory ────────────────────────
// openclaw.json.template references "${OPENCLAW_STATE_DIR}/cron/cron.json"
// but entrypoint.sh only creates: /data/vault/notes, /data/vault/maps,
// /data/vault/assets, /data/config, $OPENCLAW_STATE_DIR, $OPENCLAW_STATE_DIR/secrets
// Missing: $OPENCLAW_STATE_DIR/cron/
// OpenClaw will fail to write cron.json on first scheduled job.

describe('Entrypoint must create cron directory', () => {
  const entrypoint = read('scripts/entrypoint.sh');

  test('entrypoint creates cron directory alongside other state dirs', () => {
    // The mkdir -p line that creates state dirs should include cron
    const mkdirLines = entrypoint.split('\n').filter(l =>
      l.includes('mkdir -p') && (l.includes('OPENCLAW_STATE_DIR') || l.includes('/data/'))
    );

    const createsCronDir = mkdirLines.some(l =>
      l.includes('cron') || l.includes('$OPENCLAW_STATE_DIR/cron') || l.includes('"$OC_CRON"')
    );

    assert.ok(createsCronDir,
      'entrypoint.sh must mkdir -p $OPENCLAW_STATE_DIR/cron — cron.json needs this dir to exist');
  });
});


// ─── BUG 3: read_only filesystem + OpenClaw Node.js runtime ─────────────────
// docker-compose.yml has read_only: true. This worked for ZeroClaw (single Rust
// binary, ~5MB, writes almost nothing). OpenClaw is a full Node.js runtime that
// writes to: sessions dir, cron store, possibly npm cache, possibly temp files.
// The only writable paths are /data (volume), /home/limbo/.openclaw (volume),
// /tmp (tmpfs 100M), /home/limbo/.npm (tmpfs 50M).
//
// This test verifies that .openclaw is writable (via volume) — which covers
// sessions and cron. But it also checks that OpenClaw doesn't need to write
// anywhere OUTSIDE these paths. Since we can't run OpenClaw here, we verify
// the compose provides enough writable surface.

describe('Compose provides sufficient writable paths for OpenClaw', () => {
  const compose = read('docker-compose.yml');

  test('has writable volume for OpenClaw state dir', () => {
    assert.ok(compose.includes('.openclaw'), '.openclaw must be mounted as writable volume');
    // Verify it's NOT under tmpfs (which would be ephemeral)
    // It should be a bind mount or named volume, not tmpfs
    const lines = compose.split('\n');
    const openclawMount = lines.find(l => l.includes('.openclaw'));
    assert.ok(openclawMount, 'Should have .openclaw mount');
    // Verify it's under volumes:, not tmpfs:
    const tmpfsSection = compose.indexOf('tmpfs:');
    const volumesSection = compose.indexOf('volumes:');
    const mountIdx = compose.indexOf(openclawMount.trim());
    assert.ok(mountIdx > volumesSection || mountIdx < tmpfsSection,
      '.openclaw should be a persistent volume mount, not tmpfs');
  });

  test('has writable /tmp for OpenClaw temp operations', () => {
    assert.ok(compose.includes('/tmp'), 'Must have writable /tmp');
  });

  test('if read_only, must have tmpfs for node runtime needs', () => {
    if (!compose.includes('read_only: true')) return; // not applicable
    // Node.js may need to write to: /tmp, ~/.npm, and potentially
    // /home/limbo/.cache or /home/limbo/.local for some npm packages
    assert.ok(compose.includes('/home/limbo/.npm'),
      'read_only mode needs writable .npm for potential Node.js package cache');
  });
});


// ─── BUG 4: postinstall runs mcp-server build for CLI-only users ────────────
// package.json has a postinstall script that does:
//   cd mcp-server && npm install && node-gyp rebuild
// This runs when a user does `npm install -g limbo-ai` (CLI only).
// The CLI user doesn't need mcp-server deps — those are in the Docker image.
// This causes: (a) unnecessary 30s install, (b) possible failure on systems
// without python3/make/g++ (needed for better-sqlite3 native addon).
// The postinstall should only run in dev, not in production installs.

describe('postinstall should not break CLI-only installs', () => {
  const pkg = JSON.parse(read('package.json'));

  test('postinstall is either absent or tolerates missing mcp-server dir', () => {
    if (!pkg.scripts.postinstall) return; // no postinstall = fine

    // If postinstall exists, it must be failure-tolerant (|| true at the end)
    // AND it should check whether it's in a dev context
    const script = pkg.scripts.postinstall;
    const toleratesFailure = script.includes('|| true');
    assert.ok(toleratesFailure,
      'postinstall must tolerate failure (|| true) for CLI-only installs where mcp-server/ may not exist');

    // Ideally, it should skip entirely for production installs
    // Check if it guards against missing mcp-server dir
    const guardsExistence = script.includes('[ -d mcp-server ]') ||
                            script.includes('test -d') ||
                            script.includes('if ');
    assert.ok(guardsExistence,
      'postinstall should explicitly check for mcp-server dir before trying to build it');
  });
});


// ─── BUG 5: CLI composeContent healthcheck consistency ──────────────────────
// The static compose files use the new OpenClaw /healthz healthcheck.
// The CLI should too (verified separately in cli-compose tests), but also:
// the CLI should NOT reference zeroclaw status in any healthcheck.

describe('CLI compose healthcheck uses /healthz', () => {
  const cliSource = read('cli.js');

  test('CLI healthcheck references /healthz endpoint', () => {
    assert.ok(cliSource.includes('healthz'),
      'CLI compose healthcheck should use OpenClaw /healthz endpoint');
  });

  test('CLI healthcheck does NOT reference zeroclaw status', () => {
    assert.ok(!cliSource.includes('zeroclaw status'),
      'CLI compose healthcheck should not reference zeroclaw status command');
  });
});
