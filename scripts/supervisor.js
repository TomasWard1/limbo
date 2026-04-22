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
const { buildChannelsFromEnv } = require('../lib/build-channels');

const SETUP_SERVER_PATH = process.env.LIMBO_SETUP_SERVER_PATH || '/app/setup-server/server.js';
const OPENCLAW_BIN = process.env.LIMBO_OPENCLAW_BIN || 'openclaw';
const OPENCLAW_VERBOSE = process.env.LIMBO_VERBOSE === 'true';

// Wizard port is fixed (default 15789) so a single Google OAuth redirect
// URI can be registered for all Limbo installs. Override via LIMBO_WIZARD_PORT.
// Control plane listens on LIMBO_PORT + 2 (still derived from LIMBO_PORT).
const LIMBO_PORT = parseInt(process.env.LIMBO_PORT || '18900', 10);
const WIZARD_PORT = parseInt(process.env.LIMBO_WIZARD_PORT || '15789', 10);
const CONTROL_PORT = parseInt(process.env.LIMBO_CONTROL_PORT || String(LIMBO_PORT + 2), 10);

// Public server: enabled only when LIMBO_PUBLIC_URL is set (Limbo Cloud instances).
// Listens on port 80 by default (Cloudflare-facing).
const PUBLIC_URL = process.env.LIMBO_PUBLIC_URL || '';
const PUBLIC_PORT = PUBLIC_URL ? parseInt(process.env.LIMBO_PUBLIC_PORT || '80', 10) : null;

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${level} [supervisor] ${msg}\n`);
}

async function main() {
  const logger = {
    info: (msg, meta) => log('INFO ', meta ? `${msg} ${JSON.stringify(meta)}` : msg),
    warn: (msg, meta) => log('WARN ', meta ? `${msg} ${JSON.stringify(meta)}` : msg),
    error: (msg, meta) => log('ERROR', meta ? `${msg} ${JSON.stringify(meta)}` : msg),
  };

  let channels = {};
  try {
    channels = buildChannelsFromEnv(process.env, { logger });
  } catch (err) {
    log('FATAL', `failed to build channels: ${err && err.message}`);
    process.exit(1);
  }
  for (const name of Object.keys(channels)) {
    log('INFO ', `channel enabled: ${name}`);
  }

  const supervisor = createSupervisor({
    controlPort: CONTROL_PORT,
    channels,
    // Bind to 0.0.0.0 inside the container, NOT 127.0.0.1. Docker's port
    // mapping routes host → container via eth0, not via the container's
    // loopback interface — a server bound to the container's 127.0.0.1
    // would never receive the NAT'd traffic ("Empty reply from server").
    // The security boundary is preserved by the compose `ports:` entry
    // `127.0.0.1:18902:18902` which only publishes the port on the HOST's
    // loopback, so only processes on your machine can reach it.
    controlHost: '0.0.0.0',
    publicPort: PUBLIC_PORT,
    nodePath: process.execPath,
    setupServerPath: SETUP_SERVER_PATH,
    wizardPortBase: WIZARD_PORT,
    spawnSetupServerFn: (cmd, args, opts) => spawn(cmd, args, opts),
    launchOpenclawFn: () => {
      const args = OPENCLAW_VERBOSE ? ['gateway', '--verbose'] : ['gateway'];
      log('INFO ', `launching ${OPENCLAW_BIN} ${args.join(' ')}`);
      // OPENCLAW_NO_RESPAWN=1 tells OpenClaw to do in-process restarts
      // instead of fork+exec detached children when its config watcher
      // detects a change that requires a gateway restart (e.g. any
      // mcp.servers.*.env.* after a wizard writes new credentials).
      // Without this, OpenClaw would self-spawn a new process that
      // races against our supervisor's own respawn logic, resulting in
      // a port collision on LIMBO_PORT and a crash loop. With it,
      // OpenClaw resets state inside the same PID and our supervisor
      // never sees the child exit — the restart is transparent.
      // See lib/supervisor.js's openclaw restart loop for the safety
      // net that still catches actual crashes.
      return spawn(OPENCLAW_BIN, args, {
        stdio: 'inherit',
        env: { ...process.env, OPENCLAW_NO_RESPAWN: '1' },
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
  if (PUBLIC_PORT !== null) log('INFO ', `public server: 0.0.0.0:${PUBLIC_PORT}`);
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
