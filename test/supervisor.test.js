/**
 * Integration tests for the wizard supervisor orchestrator.
 *
 * The supervisor wires together the session store, router, HTTP server,
 * wizard spawner, and an OpenClaw child process. It's the component that
 * will replace `exec openclaw gateway` at the end of entrypoint.sh.
 *
 * These tests use real instances of the underlying modules plus fake
 * spawn implementations for both OpenClaw and setup-server so nothing
 * actually forks.
 *
 * API shape:
 *   await supervisor.start()           — awaits fully-started state
 *   supervisor.waitForShutdown()       — returns Promise resolving on shutdown
 *   await supervisor.stop()            — initiates graceful shutdown
 *
 * Run: node --test test/supervisor.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createSupervisor } = require('../lib/supervisor');
const { createControlClient } = require('../lib/control-client');

// Fake child whose kill() behaves like a real POSIX process: pushing a
// SIGTERM schedules an 'exit' event on the next tick, so the supervisor's
// `kill → await exit` sequence completes naturally without tests having to
// hand-simulate the exit for kill-driven paths. For "died on its own" tests
// (e.g. openclaw crashing), _simulateExit() still works for manual control.
function makeFakeChild({ pid = 10000 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killSignals = [];
  child.exited = false;
  child.kill = (signal = 'SIGTERM') => {
    if (child.exited) return true;
    child.killSignals.push(signal);
    setImmediate(() => {
      if (child.exited) return;
      child.exited = true;
      child.emit('exit', null, signal);
    });
    return true;
  };
  child._simulateExit = (code = 0, signal = null) => {
    if (child.exited) return;
    child.exited = true;
    child.emit('exit', code, signal);
  };
  return child;
}

function makeHarness(opts = {}) {
  let pidSeq = 20000;
  const setupChildren = [];
  const openclawChildren = [];

  const spawnSetupServerFn = opts.spawnSetupServerFn || ((command, args, spawnOpts) => {
    const child = makeFakeChild({ pid: pidSeq++ });
    child._spawnArgs = { command, args, options: spawnOpts };
    setupChildren.push(child);
    return child;
  });

  const launchOpenclawFn = opts.launchOpenclawFn || (() => {
    const child = makeFakeChild({ pid: pidSeq++ });
    openclawChildren.push(child);
    return child;
  });

  let idSeed = 0;
  // Advanceable fake clock so restart-window tests can drive time forward
  // without relying on wall clock. Start in the middle of epoch so the
  // prune window maths (`now - WINDOW_MS`) never produces a negative.
  let clockValue = 1_000_000_000;
  const clock = () => clockValue;
  function advanceClock(ms) { clockValue += ms; }

  const supervisor = createSupervisor({
    controlPort: 0, // ephemeral, parallel-safe
    spawnSetupServerFn,
    launchOpenclawFn,
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/app/setup-server/server.js',
    clock,
    idGenerator: () => `sess_${++idSeed}`,
    tokenGenerator: () => 'tok_fake',
    wizardPortBase: 18901,
  });

  // The client has to wait until supervisor.start() has bound the listener
  // before it can read the ephemeral port. Callers that need `client`
  // should call `bindClient()` AFTER `supervisor.start()`.
  function bindClient() {
    return createControlClient({ port: supervisor.controlPort });
  }

  return { supervisor, bindClient, setupChildren, openclawChildren, advanceClock };
}

// ──────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────

test('start: starts control server and launches openclaw', async () => {
  const { supervisor, bindClient, openclawChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  try {
    assert.equal(openclawChildren.length, 1);
    const h = await client.health();
    assert.equal(h.ok, true);
    assert.ok(supervisor.controlPort > 0, 'supervisor.controlPort should be a positive number after start');
  } finally {
    await supervisor.stop();
  }
});

test('wizard lifecycle: request -> ready -> setup exits 0 -> done', async () => {
  const { supervisor, bindClient, setupChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  try {
    const session = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    assert.equal(session.status, 'ready');
    assert.equal(session.port, 18901);
    assert.equal(session.token, 'tok_fake');
    assert.equal(setupChildren.length, 1);

    setupChildren[0]._simulateExit(0, null);

    let final;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
      final = await client.getWizard(session.id).catch(() => null);
      if (final && final.status === 'done') break;
    }
    assert.equal(final.status, 'done');
  } finally {
    await supervisor.stop();
  }
});

test('wizard lifecycle: setup exits non-zero -> session error', async () => {
  const { supervisor, bindClient, setupChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  try {
    const session = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    setupChildren[0]._simulateExit(42, null);
    let final;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
      final = await client.getWizard(session.id).catch(() => null);
      if (final && final.status === 'error') break;
    }
    assert.equal(final.status, 'error');
    assert.equal(final.exitCode, 42);
  } finally {
    await supervisor.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// OpenClaw-driven shutdown
// ──────────────────────────────────────────────────────────────────────────

test('openclaw exits with non-zero code: waitForShutdown resolves + listener closes', async () => {
  const { supervisor, bindClient, openclawChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  const shutdownPromise = supervisor.waitForShutdown();
  openclawChildren[0]._simulateExit(3, null);
  const result = await shutdownPromise;
  assert.equal(result.reason, 'openclaw_exit');
  assert.equal(result.code, 3);
  // TCP listener must be closed after shutdown — client requests fail fast.
  await assert.rejects(
    async () => client.health(),
    (err) => err.code === 'ECONNREFUSED'
  );
});

test('openclaw exits via SIGTERM: treated as abnormal, triggers shutdown', async () => {
  // A signal-driven exit is never a self-restart — OpenClaw's own restart
  // path does code 0 + no signal. If we see a signal here it means
  // something else killed the process (OOM, docker stop, etc.) and we
  // should NOT respawn.
  const { supervisor, openclawChildren } = makeHarness();
  await supervisor.start();
  const shutdownPromise = supervisor.waitForShutdown();
  openclawChildren[0]._simulateExit(null, 'SIGTERM');
  const result = await shutdownPromise;
  assert.equal(result.reason, 'openclaw_exit');
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(openclawChildren.length, 1, 'must NOT respawn after signal-driven exit');
});

// ──────────────────────────────────────────────────────────────────────────
// OpenClaw self-restart loop (required for connect-calendar / switch-brain)
// ──────────────────────────────────────────────────────────────────────────
//
// When OpenClaw's chokidar watcher detects a config change that requires a
// gateway restart (e.g. mcp.servers.*.env.* after a wizard writes new
// Google Calendar credentials), OpenClaw does an internal SIGUSR1 self
// restart: the old process exits with code 0 / no signal, and a fresh
// process takes over. The supervisor MUST respawn on these clean exits or
// the container cascades to shutdown mid-reload — which is exactly what
// killed the e2e smoke test before this fix existed.

test('openclaw exits cleanly (code 0, no signal): supervisor respawns and stays up', async () => {
  const { supervisor, bindClient, openclawChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  assert.equal(openclawChildren.length, 1);

  // Simulate OpenClaw self-restart: clean exit.
  openclawChildren[0]._simulateExit(0, null);

  // Give the exit handler a tick to run.
  await new Promise((r) => setImmediate(r));

  // Supervisor must have spawned a fresh OpenClaw child.
  assert.equal(openclawChildren.length, 2, 'supervisor must spawn a new openclaw after clean exit');
  // Control plane must still be up.
  const h = await client.health();
  assert.equal(h.ok, true);

  try { await supervisor.stop(); } catch {}
});

test('multiple clean self-restarts in a short window all respawn', async () => {
  const { supervisor, openclawChildren, advanceClock } = makeHarness();
  await supervisor.start();

  // 3 self-restarts spaced 1s apart — well under the 5-in-60s limit.
  for (let i = 0; i < 3; i++) {
    openclawChildren[i]._simulateExit(0, null);
    await new Promise((r) => setImmediate(r));
    advanceClock(1000);
  }
  assert.equal(openclawChildren.length, 4, 'each clean restart spawns a new child');

  try { await supervisor.stop(); } catch {}
});

test('crash loop: 6 clean restarts within window triggers shutdown with openclaw_restart_loop reason', async () => {
  const { supervisor, openclawChildren, advanceClock } = makeHarness();
  await supervisor.start();
  const shutdownPromise = supervisor.waitForShutdown();

  // Burn through the window limit. After MAX_RESTARTS (5), the next clean
  // exit must trigger a shutdown with reason=openclaw_restart_loop.
  for (let i = 0; i < 6; i++) {
    openclawChildren[i]._simulateExit(0, null);
    await new Promise((r) => setImmediate(r));
    advanceClock(100); // tight window — all within 60s
  }

  const result = await shutdownPromise;
  assert.equal(result.reason, 'openclaw_restart_loop');
  // 5 successful respawns + 1 rejected = 6 spawns total. The 6th spawn
  // was NEVER made because the supervisor hit the limit BEFORE calling
  // spawnOpenclaw a 7th time.
  assert.equal(openclawChildren.length, 6);
});

test('clean restarts spaced outside the window do not trip crash-loop guard', async () => {
  const { supervisor, openclawChildren, advanceClock } = makeHarness();
  await supervisor.start();

  // 10 restarts, but each spaced 30s apart. The sliding window (60s) only
  // holds 2 at a time, so we never approach the 5-restart cap.
  for (let i = 0; i < 10; i++) {
    openclawChildren[i]._simulateExit(0, null);
    await new Promise((r) => setImmediate(r));
    advanceClock(30_000);
  }

  assert.equal(openclawChildren.length, 11, '10 spaced restarts should all succeed');

  try { await supervisor.stop(); } catch {}
});

test('stop() during a clean-exit race: does NOT respawn after stop', async () => {
  const { supervisor, openclawChildren } = makeHarness();
  await supervisor.start();
  assert.equal(openclawChildren.length, 1);

  // stop() kills OpenClaw; the fake child's kill() schedules a clean
  // code-0 exit on the next tick. The exit handler MUST see
  // shutdownInitiated=true and skip the respawn, otherwise stop() would
  // race a fresh child forever.
  await supervisor.stop();

  // Only the one original child — no respawn during shutdown.
  assert.equal(openclawChildren.length, 1, 'stop() must not trigger respawn');
});

// ──────────────────────────────────────────────────────────────────────────
// Explicit stop
// ──────────────────────────────────────────────────────────────────────────

test('stop: forwards SIGTERM to openclaw and resolves waitForShutdown', async () => {
  const { supervisor, openclawChildren } = makeHarness();
  await supervisor.start();
  const shutdownPromise = supervisor.waitForShutdown();
  await supervisor.stop();
  const result = await shutdownPromise;
  assert.deepEqual(openclawChildren[0].killSignals, ['SIGTERM']);
  assert.equal(result.reason, 'stop_called');
});

test('stop while wizard active: kills the wizard child before shutdown', async () => {
  const { supervisor, bindClient, setupChildren, openclawChildren } = makeHarness();
  await supervisor.start();
  const client = bindClient();
  await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
  assert.equal(setupChildren.length, 1);
  await supervisor.stop();
  assert.deepEqual(setupChildren[0].killSignals, ['SIGTERM']);
  assert.deepEqual(openclawChildren[0].killSignals, ['SIGTERM']);
});

// ──────────────────────────────────────────────────────────────────────────
// Re-entry and safety
// ──────────────────────────────────────────────────────────────────────────

test('start: rejects if called twice', async () => {
  const { supervisor } = makeHarness();
  await supervisor.start();
  try {
    await assert.rejects(async () => supervisor.start(), /already/i);
  } finally {
    await supervisor.stop();
  }
});

test('stop: safe to call multiple times (idempotent)', async () => {
  const { supervisor } = makeHarness();
  await supervisor.start();
  const stop1 = supervisor.stop();
  const stop2 = supervisor.stop();
  await Promise.all([stop1, stop2]);
});

// ──────────────────────────────────────────────────────────────────────────
// Public server integration
// ──────────────────────────────────────────────────────────────────────────

const http = require('node:http');

function httpGet(port, path = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('supervisor with publicPort creates and starts public server', async () => {
  const sup = require('../lib/supervisor').createSupervisor({
    controlPort: 0,
    publicPort: 0,
    spawnSetupServerFn: (cmd, args, opts) => {
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.pid = 99999;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return child;
    },
    launchOpenclawFn: () => {
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.pid = 99998;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return child;
    },
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/setup-server/server.js',
    idGenerator: () => 'sess_pub_1',
    tokenGenerator: () => 'tok_pub',
    wizardPortBase: 18901,
  });

  await sup.start();
  try {
    assert.ok(sup.publicPort > 0, 'publicPort should be a positive number after start');
    const res = await httpGet(sup.publicPort);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Limbo'));
  } finally {
    await sup.stop();
  }
});

test('supervisor with publicPort=0 leaves publicPort as null', async () => {
  const { supervisor } = makeHarness();
  await supervisor.start();
  try {
    assert.equal(supervisor.publicPort, null);
  } finally {
    await supervisor.stop();
  }
});

test('wizard request sets wizard target on public server', async () => {
  // Spin up a tiny HTTP server to act as the wizard target
  const wizardServerPayload = 'wizard-ui';
  const backendServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(wizardServerPayload);
  });
  await new Promise((resolve) => backendServer.listen(0, '127.0.0.1', resolve));
  const backendPort = backendServer.address().port;

  const sup = require('../lib/supervisor').createSupervisor({
    controlPort: 0,
    publicPort: 0,
    spawnSetupServerFn: (cmd, args, opts) => {
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.pid = 88888;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return child;
    },
    launchOpenclawFn: () => {
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.pid = 88887;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return child;
    },
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/setup-server/server.js',
    idGenerator: (() => { let n = 0; return () => `sess_wiz_${++n}`; })(),
    tokenGenerator: () => 'tok_wiz',
    // wizardPortBase points at our fake backend so we can verify proxying
    wizardPortBase: backendPort,
  });

  await sup.start();
  const { createControlClient } = require('../lib/control-client');
  const client = createControlClient({ port: sup.controlPort });

  try {
    // Before wizard: static page
    const before = await httpGet(sup.publicPort);
    assert.ok(before.body.includes('Limbo'));

    // Request wizard — supervisor calls setWizardTarget(wizardPortBase)
    await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });

    // Public server should now proxy to the wizard backend
    const proxied = await httpGet(sup.publicPort);
    assert.equal(proxied.body, wizardServerPayload);
  } finally {
    await sup.stop();
    await new Promise((r) => backendServer.close(r));
  }
});

test('wizard exit clears wizard target on public server', async () => {
  const { EventEmitter } = require('node:events');
  let setupChild = null;

  const sup = require('../lib/supervisor').createSupervisor({
    controlPort: 0,
    publicPort: 0,
    spawnSetupServerFn: (cmd, args, opts) => {
      const child = new EventEmitter();
      child.pid = 77777;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      setupChild = child;
      return child;
    },
    launchOpenclawFn: () => {
      const child = new EventEmitter();
      child.pid = 77776;
      child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return child;
    },
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/setup-server/server.js',
    idGenerator: (() => { let n = 0; return () => `sess_exit_${++n}`; })(),
    tokenGenerator: () => 'tok_exit',
    wizardPortBase: 18901,
  });

  await sup.start();
  const { createControlClient } = require('../lib/control-client');
  const client = createControlClient({ port: sup.controlPort });

  try {
    await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    assert.ok(setupChild, 'setup child should have been spawned');

    // Simulate wizard exit
    setupChild.emit('exit', 0, null);

    // Give the exit handler a tick to run
    await new Promise((r) => setImmediate(r));

    // Public server should be back to static page
    const res = await httpGet(sup.publicPort);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Limbo'), 'should serve static page after wizard exits');
  } finally {
    await sup.stop();
  }
});
