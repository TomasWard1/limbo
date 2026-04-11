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

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createSupervisor } = require('../lib/supervisor');
const { createControlClient } = require('../lib/control-client');

let tmpRoot;
before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-supervisor-test-'));
});
after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

let counter = 0;
function uniqueSocketPath() {
  counter++;
  return path.join(tmpRoot, `sup-${process.pid}-${counter}.sock`);
}

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

  const socketPath = uniqueSocketPath();

  let idSeed = 0;
  const supervisor = createSupervisor({
    socketPath,
    spawnSetupServerFn,
    launchOpenclawFn,
    nodePath: '/fake/bin/node',
    setupServerPath: '/fake/app/setup-server/server.js',
    clock: () => 1_000_000,
    idGenerator: () => `sess_${++idSeed}`,
    tokenGenerator: () => 'tok_fake',
    wizardPortBase: 18901,
  });

  const client = createControlClient({ socketPath });

  return { supervisor, client, socketPath, setupChildren, openclawChildren };
}

// ──────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────

test('start: starts control server and launches openclaw', async () => {
  const { supervisor, client, openclawChildren } = makeHarness();
  await supervisor.start();
  try {
    assert.equal(openclawChildren.length, 1);
    const h = await client.health();
    assert.equal(h.ok, true);
  } finally {
    await supervisor.stop();
  }
});

test('wizard lifecycle: request -> ready -> setup exits 0 -> done', async () => {
  const { supervisor, client, setupChildren } = makeHarness();
  await supervisor.start();
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
  const { supervisor, client, setupChildren } = makeHarness();
  await supervisor.start();
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

test('openclaw exits: waitForShutdown resolves with that exit code', async () => {
  const { supervisor, openclawChildren, socketPath } = makeHarness();
  await supervisor.start();
  const shutdownPromise = supervisor.waitForShutdown();
  openclawChildren[0]._simulateExit(3, null);
  const result = await shutdownPromise;
  assert.equal(result.reason, 'openclaw_exit');
  assert.equal(result.code, 3);
  assert.equal(fs.existsSync(socketPath), false);
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
  const { supervisor, client, setupChildren, openclawChildren } = makeHarness();
  await supervisor.start();
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
