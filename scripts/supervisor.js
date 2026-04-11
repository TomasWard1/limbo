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
 *   - Exposes the wizard control plane on a TCP port bound to 127.0.0.1
 *     (default LIMBO_PORT + 2 = 18902). The compose file publishes this
 *     port as 127.0.0.1:${LIMBO_CONTROL_PORT}:${LIMBO_CONTROL_PORT} so the
 *     host CLI can reach the supervisor without any Unix-socket gymnastics.
 *   - Forwards container signals (SIGTERM / SIGINT) into a graceful
 *     supervisor.stop() so OpenClaw + any active wizard get clean teardown.
 *   - Exits with OpenClaw's exit code when OpenClaw dies, so Docker's
 *     restart policy observes the real OpenClaw health.
 */

const { spawn } = require('node:child_process');
const { createSupervisor } = require('../lib/supervisor');

const SETUP_SERVER_PATH = process.env.LIMBO_SETUP_SERVER_PATH || '/app/setup-server/server.js';
const OPENCLAW_BIN = process.env.LIMBO_OPENCLAW_BIN || 'openclaw';
const OPENCLAW_VERBOSE = process.env.LIMBO_VERBOSE === 'true';

// Wizards listen on LIMBO_PORT + 1 so they don't collide with OpenClaw on
// LIMBO_PORT. The control plane listens on LIMBO_PORT + 2. The compose
// file publishes both extra ports; the host CLI reaches the control plane
// via 127.0.0.1:${LIMBO_CONTROL_PORT} and the wizard via
// 127.0.0.1:${LIMBO_PORT + 1}.
const LIMBO_PORT = parseInt(process.env.LIMBO_PORT || '18900', 10);
const WIZARD_PORT_BASE = LIMBO_PORT + 1;
const CONTROL_PORT = parseInt(process.env.LIMBO_CONTROL_PORT || String(LIMBO_PORT + 2), 10);

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${level} [supervisor] ${msg}\n`);
}

async function main() {
  const supervisor = createSupervisor({
    controlPort: CONTROL_PORT,
    controlHost: '127.0.0.1',
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

  log('INFO ', `control plane: 127.0.0.1:${CONTROL_PORT}`);
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
