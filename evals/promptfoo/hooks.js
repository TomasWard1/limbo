'use strict';

/**
 * Promptfoo hooks for Limbo eval lifecycle.
 *
 * beforeAll: resets vault to seed state once at the start of the eval run.
 * Tests are ordered to avoid conflicts (reads first, writes last).
 */

const { spawnSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONTAINER = process.env.LIMBO_EVAL_CONTAINER || 'limbo-eval';
const AGENT_BIN = 'openclaw';
const AGENT_HOME = `/home/limbo/.${AGENT_BIN}`;
const SEEDS_DIR = path.join(__dirname, 'seeds');
const GWS_MOCK_DIR = path.resolve(__dirname, '..', 'fixtures', 'gws');

function wipeVault() {
  spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c',
    'rm -rf /data/vault/notes/* /data/vault/maps/* /data/vault/assets/* /data/db/search.db*',
  ], { timeout: 10000 });
}

function seedVault() {
  const notesDir = path.join(SEEDS_DIR, 'notes');
  const mapsDir = path.join(SEEDS_DIR, 'maps');

  if (fs.existsSync(notesDir) && fs.readdirSync(notesDir).length > 0) {
    spawnSync('docker', ['cp', notesDir + '/.', `${CONTAINER}:/data/vault/notes/`], { timeout: 10000 });
  }
  if (fs.existsSync(mapsDir) && fs.readdirSync(mapsDir).length > 0) {
    spawnSync('docker', ['cp', mapsDir + '/.', `${CONTAINER}:/data/vault/maps/`], { timeout: 10000 });
  }
}

function resetUserProfile() {
  const content = [
    '# About Your User',
    '',
    '## Identity',
    '',
    '- **Name:** Tomas',
    '- **Timezone:** ',
    '- **Language:** Spanish',
    '',
    '## Communication Preferences',
    '',
    'Respond in **Spanish**. Keep responses concise.',
    'Address the user as **Tomas** when natural.',
    '',
    '## Additional Context',
    '',
    'No additional context provided.',
  ].join('\n');

  spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c',
    `mkdir -p ${AGENT_HOME}/workspace && cat > ${AGENT_HOME}/workspace/USER.md << 'EOFPROFILE'\n${content}\nEOFPROFILE`,
  ], { timeout: 5000 });
}

function clearCrons() {
  const result = spawnSync('docker', [
    'exec', CONTAINER, AGENT_BIN, 'cron', 'list', '--json',
  ], { encoding: 'utf8', timeout: 10000 });
  try {
    const data = JSON.parse(result.stdout || '{}');
    for (const job of (data.jobs || [])) {
      spawnSync('docker', ['exec', CONTAINER, AGENT_BIN, 'cron', 'remove', job.id], { timeout: 5000 });
    }
  } catch {}
}

function clearMcpLog() {
  spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c', '> /data/logs/mcp.log',
  ], { timeout: 5000 });
}

/**
 * Install a mock gws binary + fixture credentials inside the eval container
 * so calendar_read / calendar_create tests stay deterministic and never hit
 * real Google APIs.
 *
 * This runs BEFORE clearSessions() (which restarts the container), so the
 * entrypoint picks up the dummy credentials file and enables the Google
 * Calendar MCP tools. The mock binary persists across restarts because
 * /usr/local/bin and the container filesystem are not on a volume.
 */
function setupGoogleCalendarMock() {
  // The container runs as the unprivileged `limbo` user (uid 999), which
  // cannot write to /eval-mocks or /usr/local/bin. Use `-u 0` on docker
  // exec to run setup commands as root — docker cp already runs as root.
  const execRoot = (cmd) => spawnSync('docker', [
    'exec', '-u', '0', CONTAINER, 'sh', '-c', cmd,
  ], { encoding: 'utf8', timeout: 10000 });

  // 1. Write dummy authorized_user credentials into the state volume so
  //    the entrypoint's `[ -f "$GCAL_CREDS" ]` check passes and enables
  //    the calendar tools (see scripts/entrypoint.sh ~L390).
  const secretsDir = `${AGENT_HOME}/secrets`;
  const credsTarget = `${secretsDir}/google_calendar_credentials.json`;
  execRoot(`mkdir -p ${secretsDir} && chown -R limbo:limbo ${secretsDir}`);
  spawnSync('docker', [
    'cp',
    path.join(GWS_MOCK_DIR, 'credentials.json'),
    `${CONTAINER}:${credsTarget}`,
  ], { timeout: 5000 });
  // docker cp preserves the host ownership — chown back to limbo so the
  // MCP server (running as limbo) can read the file.
  execRoot(`chown limbo:limbo ${credsTarget}`);

  // 2. Prepare /eval-mocks/gws/ (root-owned is fine — world-readable).
  execRoot('mkdir -p /eval-mocks/gws');
  spawnSync('docker', [
    'cp',
    GWS_MOCK_DIR + '/.',
    `${CONTAINER}:/eval-mocks/gws/`,
  ], { timeout: 5000 });

  // 3. Override the real gws in /usr/local/bin. `rm -f` first because the
  //    npm-installed binary is a symlink to run.js — a naked `ln -sf` would
  //    follow it and overwrite the wrong file. World-readable + executable.
  execRoot(
    'chmod +x /eval-mocks/gws/gws && ' +
    'chmod a+r /eval-mocks/gws/*.json && ' +
    'rm -f /usr/local/bin/gws && ' +
    'ln -s /eval-mocks/gws/gws /usr/local/bin/gws'
  );

  // 4. Sanity check — fail loud if the mock isn't wired up correctly. The
  //    alternative is a confusing "calendar auth failed" downstream.
  const check = spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c',
    'gws calendar events list --params "{}" --format json 2>&1 | head -1',
  ], { encoding: 'utf8', timeout: 5000 });
  if (!check.stdout || !check.stdout.includes('{')) {
    throw new Error(`Mock gws install failed — probe returned: ${(check.stdout || check.stderr || '').trim()}`);
  }
}

function clearSessions() {
  // Delete session stores and restart gateway to clear in-memory state
  spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c',
    `rm -rf ${AGENT_HOME}/agents/*/agent/sessions`,
  ], { timeout: 5000 });
  // Restart the gateway process — container stays up, entrypoint re-runs
  spawnSync('docker', ['restart', CONTAINER], { timeout: 30000 });
  // Wait for gateway to be ready
  for (let i = 0; i < 20; i++) {
    const check = spawnSync('docker', [
      'exec', CONTAINER, 'sh', '-c',
      'node -e "fetch(\'http://localhost:18789/healthz\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null || node -e "fetch(\'http://localhost:18900/healthz\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"',
    ], { timeout: 5000 });
    if (check.status === 0) break;
    spawnSync('sleep', ['1']);
  }
}

/**
 * Full reset — call once before the entire eval run.
 */
function beforeAll() {
  // 1. Install mock gws + dummy Google Calendar credentials into the running
  //    container BEFORE restarting. The restart below re-runs the entrypoint,
  //    which now finds the credentials file and enables the calendar MCP
  //    tools in openclaw.json. The mock binary persists because it lives on
  //    the container filesystem (not a volume).
  setupGoogleCalendarMock();
  // 2. Clear sessions + restart gateway (clears in-memory state, picks up
  //    the calendar creds we just wrote)
  clearSessions();
  // 3. After restart: wipe vault, seed, reset profile, clear crons, clear logs
  wipeVault();
  seedVault();
  // 3. Delete FTS index AFTER seeding so the MCP server rebuilds it with seed data
  spawnSync('docker', [
    'exec', CONTAINER, 'sh', '-c', 'rm -f /data/db/search.db*',
  ], { timeout: 5000 });
  resetUserProfile();
  clearCrons();
  clearMcpLog();
}

module.exports = { beforeAll, wipeVault, seedVault, resetUserProfile, clearCrons, clearMcpLog, setupGoogleCalendarMock };
