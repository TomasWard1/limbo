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
  // 1. Clear sessions + restart gateway (clears in-memory state)
  clearSessions();
  // 2. After restart: wipe vault, seed, reset profile, clear crons, clear logs
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

module.exports = { beforeAll, wipeVault, seedVault, resetUserProfile, clearCrons, clearMcpLog };
