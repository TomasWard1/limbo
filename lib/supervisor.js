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
 * This module replaces the old `exec openclaw gateway` at the end of
 * entrypoint.sh. The supervisor becomes the container's main process:
 * it launches OpenClaw as a child, exposes the wizard control plane on
 * a TCP loopback port, and shuts everything down cleanly when either
 * OpenClaw exits on its own or the caller invokes stop().
 *
 * API:
 *   await supervisor.start()           awaits fully-started state
 *   supervisor.waitForShutdown()       Promise that resolves on shutdown
 *   await supervisor.stop()            initiates graceful shutdown
 *
 * Child process factories (spawnSetupServerFn, launchOpenclawFn) are
 * injectable so tests use fake children instead of real forks.
 */

const crypto = require('node:crypto');
const { createSessionStore } = require('./session-store');
const { createControlRouter } = require('./control-router');
const { createControlServer } = require('./control-server');
const { createWizardSpawner } = require('./wizard-spawner');

const TERMINAL_STATUSES = new Set(['done', 'error', 'timeout']);

function createSupervisor(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('createSupervisor: options are required');
  }
  const {
    controlPort,
    controlHost = '127.0.0.1',
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

      return { port, token };
    },
    onWizardCancelled: async (session) => {
      try { await spawner.kill(session.id); } catch { /* best-effort */ }
    },
  };

  const router = createControlRouter({ store, handlers });
  const server = createControlServer({ router, port: controlPort, host: controlHost });

  // ── Supervisor state ──────────────────────────────────────────────────

  let started = false;
  let openclawChild = null;
  let openclawExited = false;
  let openclawExitPromise = null;

  let shutdownInitiated = false;
  let shutdownPromise = null;
  let shutdownResolver = null;
  const shutdownObservers = new Promise((resolve) => { shutdownResolver = resolve; });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async function start() {
    if (started) {
      throw new Error('supervisor.start(): already started');
    }
    started = true;

    await server.start();

    openclawChild = launchOpenclawFn();

    // Install exit listener and expose it as a promise so stop() can await
    // the child's actual death without re-attaching listeners (Node would
    // complain about multiple once('exit') handlers resolving twice).
    openclawExitPromise = new Promise((resolve) => {
      openclawChild.once('exit', (code, signal) => {
        openclawExited = true;
        resolve({ code, signal });
        if (!shutdownInitiated) {
          // OpenClaw died on its own — initiate shutdown.
          shutdown({ reason: 'openclaw_exit', code, signal });
        }
      });
    });
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

      // 3. Stop the control server (closes TCP listener).
      try { await server.stop(); } catch { /* best-effort */ }

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
  };
}

module.exports = { createSupervisor };
