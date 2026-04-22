'use strict';

/**
 * Wizard supervisor — container-level orchestrator.
 *
 * Wires together:
 *   - session store (in-memory state machine of wizard sessions)
 *   - wizard spawner (manages setup-server child processes)
 *   - control router (HTTP routing over the session store + handlers)
 *   - control server (TCP HTTP server bound to 127.0.0.1 inside the
 *     container, published to the host via Docker port mapping)
 *   - OpenClaw child process (the actual agent gateway)
 *
 * The supervisor is the container's main process: it launches OpenClaw
 * as a child, exposes the wizard control plane on a TCP loopback port,
 * and shuts everything down cleanly when either OpenClaw exits on its
 * own or the caller invokes stop().
 *
 * Child process factories (spawnSetupServerFn, launchOpenclawFn) are
 * injectable so tests use fake children instead of real forks.
 */

const crypto = require('node:crypto');
const { createSessionStore } = require('./session-store');
const { createControlRouter } = require('./control-router');
const { createControlServer } = require('./control-server');
const { createPublicServer } = require('./public-server');
const { createWizardSpawner } = require('./wizard-spawner');

const TERMINAL_STATUSES = new Set(['done', 'error', 'timeout']);

// OpenClaw self-restart window. When OpenClaw's config watcher detects a
// change that requires a gateway restart (e.g. mcp.servers.*.env.* — which
// IS our connect-calendar code path), OpenClaw spawns a NEW process and
// the old one exits with code 0. The supervisor sees that as "my child
// died" and would cascade-shutdown the container without this restart
// loop. We allow up to OPENCLAW_MAX_RESTARTS clean exits inside
// OPENCLAW_RESTART_WINDOW_MS before giving up and triggering shutdown.
// That is enough headroom for normal config reloads (one per wizard) and
// small enough to catch a real crash loop.
const OPENCLAW_MAX_RESTARTS = 5;
const OPENCLAW_RESTART_WINDOW_MS = 60 * 1000;

function createSupervisor(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('createSupervisor: options are required');
  }
  const {
    controlPort,
    controlHost = '127.0.0.1',
    publicPort = null,
    publicHost = '0.0.0.0',
    spawnSetupServerFn,
    launchOpenclawFn,
    nodePath,
    setupServerPath,
    clock = () => Date.now(),
    idGenerator,
    tokenGenerator = () => crypto.randomBytes(16).toString('hex'),
    wizardPortBase = 18901,
  } = opts;

  if (typeof controlPort !== 'number' || controlPort < 0 || controlPort > 65535) {
    throw new Error('createSupervisor: controlPort must be a number in 0..65535 (0 = ephemeral, for tests)');
  }
  if (typeof launchOpenclawFn !== 'function') {
    throw new Error('createSupervisor: launchOpenclawFn is required');
  }
  if (typeof spawnSetupServerFn !== 'function') {
    throw new Error('createSupervisor: spawnSetupServerFn is required');
  }

  const store = createSessionStore({ clock, idGenerator });
  const spawner = createWizardSpawner({
    spawnFn: spawnSetupServerFn,
    nodePath,
    setupServerPath,
  });

  // ── Handlers wired to the router ──────────────────────────────────────

  const handlers = {
    onWizardRequested: async ({ session }) => {
      const port = wizardPortBase;
      const token = tokenGenerator();

      const { exitPromise } = await spawner.start({
        sessionId: session.id,
        feature: session.feature,
        port,
        token,
      });

      // Observe the child's exit and transition the session state in the
      // store. Terminal-wins logic in the store guarantees we never
      // overwrite done/error/timeout with a stale update.
      exitPromise.then((result) => {
        if (publicServer) publicServer.clearWizardTarget();
        try {
          const current = store.get(session.id);
          if (!current) return;
          if (TERMINAL_STATUSES.has(current.status)) return;
          store.update(session.id, {
            status: result.code === 0 ? 'done' : 'error',
            exitCode: result.code,
            exitSignal: result.signal,
          });
        } catch {
          // Session might have been removed or already terminal.
        }
      });

      if (publicServer) publicServer.setWizardTarget(port);

      return { port, token };
    },
    onWizardCancelled: async (session) => {
      if (publicServer) publicServer.clearWizardTarget();
      try { await spawner.kill(session.id); } catch { /* best-effort */ }
    },
  };

  const router = createControlRouter({ store, handlers });
  const server = createControlServer({ router, port: controlPort, host: controlHost });
  const publicServer = publicPort !== null
    ? createPublicServer({ port: publicPort, host: publicHost })
    : null;

  // ── Supervisor state ──────────────────────────────────────────────────

  let started = false;
  // openclawChild always points to the LATEST spawn — it is replaced each
  // time we respawn after a clean self-restart. openclawExitPromise mirrors
  // the current child's exit, so stop() always awaits the in-flight child.
  let openclawChild = null;
  let openclawExited = false;
  let openclawExitPromise = null;
  const openclawRestartTimestamps = []; // sliding-window guard against crash loops

  let shutdownInitiated = false;
  let shutdownPromise = null;
  let shutdownResolver = null;
  const shutdownObservers = new Promise((resolve) => { shutdownResolver = resolve; });

  // ── OpenClaw lifecycle (spawn + restart loop) ─────────────────────────

  function pruneRestartWindow(now) {
    const cutoff = now - OPENCLAW_RESTART_WINDOW_MS;
    while (openclawRestartTimestamps.length > 0 && openclawRestartTimestamps[0] < cutoff) {
      openclawRestartTimestamps.shift();
    }
  }

  // Spawn the next OpenClaw child and wire its exit handler. Called once
  // at start() and again after every clean self-restart.
  function spawnOpenclaw() {
    openclawChild = launchOpenclawFn();
    openclawExited = false;

    openclawExitPromise = new Promise((resolve) => {
      openclawChild.once('exit', (code, signal) => {
        openclawExited = true;
        resolve({ code, signal });

        // If shutdown was already in progress, let shutdown()'s existing
        // await openclawExitPromise unblock — do NOT respawn.
        if (shutdownInitiated) return;

        // Abnormal exit (crashed or killed by signal) → initiate shutdown.
        // A signal-driven exit is never a self-restart: OpenClaw's
        // self-restart path does a clean fork+exec and the old process
        // exits with code 0 and no signal.
        if (code !== 0 || signal) {
          shutdown({ reason: 'openclaw_exit', code, signal });
          return;
        }

        // Clean exit (code 0, no signal) → most likely OpenClaw's own
        // self-restart triggered by a config change that "requires gateway
        // restart" (e.g. mcp.servers.*.env.* after a wizard). Respawn,
        // guarded by a sliding-window crash-loop detector.
        const now = clock();
        pruneRestartWindow(now);
        if (openclawRestartTimestamps.length >= OPENCLAW_MAX_RESTARTS) {
          shutdown({
            reason: 'openclaw_restart_loop',
            code,
            signal,
            message: `OpenClaw restarted ${openclawRestartTimestamps.length} times in ${OPENCLAW_RESTART_WINDOW_MS}ms — giving up`,
          });
          return;
        }
        openclawRestartTimestamps.push(now);
        try {
          spawnOpenclaw();
        } catch (err) {
          shutdown({ reason: 'openclaw_respawn_failed', code, signal, error: err.message || String(err) });
        }
      });
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async function start() {
    if (started) {
      throw new Error('supervisor.start(): already started');
    }
    started = true;

    await server.start();
    if (publicServer) await publicServer.start();
    spawnOpenclaw();
  }

  function waitForShutdown() {
    return shutdownObservers;
  }

  async function stop() {
    return shutdown({ reason: 'stop_called', code: 0, signal: null });
  }

  async function shutdown(info) {
    if (shutdownPromise) return shutdownPromise;
    shutdownInitiated = true;
    shutdownPromise = (async () => {
      // 1. Kill any active wizards. spawner.kill awaits the child's exit.
      for (const w of spawner.active()) {
        try { await spawner.kill(w.sessionId); } catch { /* best-effort */ }
      }

      // 2. Kill OpenClaw if it has not already exited, and wait for the
      //    exit event to fire (the listener installed in start() resolves
      //    openclawExitPromise).
      if (openclawChild && !openclawExited) {
        try { openclawChild.kill('SIGTERM'); } catch { /* already dead */ }
        try { await openclawExitPromise; } catch { /* ignore */ }
      }

      // 3. Stop the control server and public server (closes TCP listeners).
      try { await server.stop(); } catch { /* best-effort */ }
      if (publicServer) {
        try { await publicServer.stop(); } catch { /* best-effort */ }
      }

      // 4. Resolve the public shutdown observer.
      shutdownResolver(info);
      return info;
    })();
    return shutdownPromise;
  }

  return {
    start,
    stop,
    waitForShutdown,
    get controlPort() { return server.port; },
    get publicPort() { return publicServer ? publicServer.port : null; },
  };
}

module.exports = { createSupervisor };
