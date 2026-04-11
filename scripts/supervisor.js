#!/usr/bin/env node
'use strict';

/**
 * Limbo supervisor — container main process.
 *
 * This script is the container's entrypoint final step (launched by
 * scripts/entrypoint.sh via `exec node /app/scripts/supervisor.js`). It
 * wires the real child-process implementations into createSupervisor from
 * lib/supervisor.js.
 *
 * Responsibilities:
 *   - Launches OpenClaw as a child (taking the place of the old
 *     `exec openclaw gateway` at the end of entrypoint.sh).
 *   - Exposes the wizard control plane on a Unix Domain Socket at
 *     /data/control/supervisor.sock (bind-mounted from the host as
 *     ~/.limbo/control/supervisor.sock).
 *   - Forwards container signals (SIGTERM / SIGINT) into a graceful
 *     supervisor.stop() so OpenClaw + any active wizard get clean teardown.
 *   - Exits with OpenClaw's exit code when OpenClaw dies, so Docker's
 *     restart policy observes the real OpenClaw health.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { createSupervisor } = require('../lib/supervisor');

const SOCKET_PATH = process.env.LIMBO_CONTROL_SOCKET || '/data/control/supervisor.sock';
const SETUP_SERVER_PATH = process.env.LIMBO_SETUP_SERVER_PATH || '/app/setup-server/server.js';
const OPENCLAW_BIN = process.env.LIMBO_OPENCLAW_BIN || 'openclaw';
const OPENCLAW_VERBOSE = process.env.LIMBO_VERBOSE === 'true';

// Wizards listen on LIMBO_PORT + 1 so they don't collide with OpenClaw on
// LIMBO_PORT. The compose file exposes both ports; the user reaches the
// wizard via an SSH forward or cloudflare tunnel pointed at wizard port.
const LIMBO_PORT = parseInt(process.env.LIMBO_PORT || '18900', 10);
const WIZARD_PORT_BASE = LIMBO_PORT + 1;

// Ensure the control socket directory exists before the server tries to
// bind. In production this is a bind-mounted dir from the host.
try { fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true }); } catch {}

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${level} [supervisor] ${msg}\n`);
}

async function main() {
  const supervisor = createSupervisor({
    socketPath: SOCKET_PATH,
    nodePath: process.execPath,
    setupServerPath: SETUP_SERVER_PATH,
    wizardPortBase: WIZARD_PORT_BASE,
    spawnSetupServerFn: (cmd, args, opts) => spawn(cmd, args, opts),
    launchOpenclawFn: () => {
      const args = OPENCLAW_VERBOSE ? ['gateway', '--verbose'] : ['gateway'];
      log('INFO ', `launching ${OPENCLAW_BIN} ${args.join(' ')}`);
      return spawn(OPENCLAW_BIN, args, {
        stdio: 'inherit',
        env: process.env,
      });
    },
  });

  const onSignal = (signal) => {
    log('INFO ', `received ${signal}; initiating graceful shutdown`);
    supervisor.stop().catch((err) => {
      log('ERROR', `stop() failed: ${err && err.message}`);
    });
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  log('INFO ', `control socket: ${SOCKET_PATH}`);
  await supervisor.start();
  log('INFO ', 'started — awaiting shutdown signal or OpenClaw exit');

  const result = await supervisor.waitForShutdown();
  log('INFO ', `shutting down: reason=${result.reason} code=${result.code} signal=${result.signal || '-'}`);
  process.exit(result.code || 0);
}

main().catch((err) => {
  log('FATAL', `unhandled error: ${err && (err.stack || err.message)}`);
  process.exit(1);
});
