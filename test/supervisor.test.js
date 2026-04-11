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
  const supervisor = createSupervisor({
    controlPort: 0, // ephemeral, parallel-safe
    spawnSetupServerFn,
    launchOpenclawFn,
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/app/setup-server/server.js',
    clock: () => 1_000_000,
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

  return { supervisor, bindClient, setupChildren, openclawChildren };
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

test('openclaw exits: waitForShutdown resolves with that exit code and closes the listener', async () => {
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
