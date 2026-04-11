'use strict';

/**
 * Wizard spawner — lifecycle manager for setup-server child processes.
 *
 * Given (sessionId, feature, port, token), spawns a Node child running the
 * setup-server with the appropriate environment, tracks it in an active map,
 * and exposes:
 *
 *     const { pid, exitPromise } = await spawner.start({...})
 *
 * Callers use `exitPromise` to observe the child's lifetime and transition
 * session state (e.g. from `ready` to `done`) when the wizard completes.
 *
 * The child-process spawn function is injectable, so unit tests use fake
 * children without touching real processes. In production, the supervisor
 * wires it to child_process.spawn.
 *
 * Supported features (default whitelist):
 *   - calendar/gmail/drive → CONNECT_<FEATURE>_MODE (Google integrations)
 *   - switch-brain         → SWITCH_BRAIN_MODE (change AI provider)
 *
 * Each key maps to a <MODE>=true env var recognized by the setup-server's
 * wizard dispatcher. Adding a new incremental wizard type is a one-line
 * change here plus a matching handler in setup-server/server.js.
 */

const DEFAULT_FEATURE_MODE_ENV = {
  calendar: 'CONNECT_CALENDAR_MODE',
  gmail: 'CONNECT_GMAIL_MODE',
  drive: 'CONNECT_DRIVE_MODE',
  'switch-brain': 'SWITCH_BRAIN_MODE',
};

function createWizardSpawner(opts = {}) {
  const spawnFn = opts.spawnFn;
  const nodePath = opts.nodePath;
  const setupServerPath = opts.setupServerPath;
  const featureModeEnv = opts.featureModeEnv || DEFAULT_FEATURE_MODE_ENV;

  if (typeof spawnFn !== 'function') {
    throw new Error('createWizardSpawner: spawnFn is required');
  }
  if (typeof nodePath !== 'string' || nodePath.length === 0) {
    throw new Error('createWizardSpawner: nodePath is required');
  }
  if (typeof setupServerPath !== 'string' || setupServerPath.length === 0) {
    throw new Error('createWizardSpawner: setupServerPath is required');
  }

  /**
   * Map<sessionId, { child, feature, port, token, exitPromise }>
   */
  const activeSessions = new Map();

  async function start({ sessionId, feature, port, token, env: extraEnv }) {
    if (!sessionId) throw new Error('start: sessionId is required');
    if (!feature) throw new Error('start: feature is required');
    if (typeof port !== 'number' || port <= 0) throw new Error('start: port must be a positive number');
    if (typeof token !== 'string' || !token) throw new Error('start: token is required');

    const modeEnvKey = featureModeEnv[feature];
    if (!modeEnvKey) {
      throw new Error(`start: unknown feature "${feature}"`);
    }

    if (activeSessions.has(sessionId)) {
      throw new Error(`start: session ${sessionId} already running`);
    }

    const childEnv = {
      ...process.env,
      ...(extraEnv || {}),
      SETUP_TOKEN: token,
      LIMBO_PORT: String(port),
      [modeEnvKey]: 'true',
    };

    let child;
    try {
      child = spawnFn(nodePath, [setupServerPath], {
        env: childEnv,
        stdio: 'inherit',
      });
    } catch (err) {
      // spawnFn may throw synchronously (ENOENT, permission denied, etc.)
      throw err;
    }

    // Wrap exit in a single promise so multiple observers share the same
    // resolution. Install the listener before returning so early exits are
    // captured even if the child dies between spawn and our return.
    const exitPromise = new Promise((resolve) => {
      const onExit = (code, signal) => {
        activeSessions.delete(sessionId);
        resolve({ code, signal });
      };
      child.once('exit', onExit);
    });

    activeSessions.set(sessionId, {
      sessionId,
      feature,
      port,
      child,
      exitPromise,
    });

    return { pid: child.pid, exitPromise };
  }

  async function kill(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`kill: session ${sessionId} not found`);
    }
    try {
      session.child.kill('SIGTERM');
    } catch { /* already dead */ }
    // Wait for the exit event to propagate through the promise so callers
    // know the process is really gone before we return.
    await session.exitPromise;
  }

  function active() {
    return Array.from(activeSessions.values()).map((s) => ({
      sessionId: s.sessionId,
      feature: s.feature,
      port: s.port,
      pid: s.child.pid,
    }));
  }

  return { start, kill, active };
}

module.exports = { createWizardSpawner };
