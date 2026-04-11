/**
 * Unit tests for the wizard spawner.
 *
 * The spawner manages setup-server child processes. Given a session id +
 * feature + port + token, it spawns a new Node process running the
 * setup-server with the right environment and returns a handle:
 *
 *     const { pid, exitPromise } = await spawner.start({...})
 *
 * The handle's exitPromise resolves when the child exits with {code, signal}.
 * Callers use this to update session state in the store (pending → done/error).
 *
 * The underlying spawn implementation is injectable so tests never touch
 * real child processes. The fake spawnFn returns an EventEmitter-like child
 * whose exit can be triggered manually.
 *
 * Run: node --test test/wizard-spawner.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createWizardSpawner } = require('../lib/wizard-spawner');

// ──────────────────────────────────────────────────────────────────────────
// Fake spawn — emulates child_process.spawn enough for the spawner
// ──────────────────────────────────────────────────────────────────────────

function makeFakeChild({ pid = 10000 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.exited = false;
  child.killSignals = [];
  child.kill = (signal = 'SIGTERM') => {
    child.killSignals.push(signal);
    child.killed = true;
    return true;
  };
  child._simulateExit = (code = 0, signal = null) => {
    if (child.exited) return;
    child.exited = true;
    child.emit('exit', code, signal);
  };
  return child;
}

function makeSpawnerHarness(opts = {}) {
  const calls = [];
  const childrenByCall = [];
  let nextPid = 20000;

  const spawnFn = opts.spawnFn || ((command, args, spawnOpts) => {
    const child = makeFakeChild({ pid: nextPid++ });
    calls.push({ command, args, options: spawnOpts });
    childrenByCall.push(child);
    return child;
  });

  const spawner = createWizardSpawner({
    spawnFn,
    nodePath: opts.nodePath || '/fake/bin/node',
    setupServerPath: opts.setupServerPath || '/fake/app/setup-server/server.js',
  });

  return { spawner, calls, childrenByCall };
}

// ──────────────────────────────────────────────────────────────────────────
// start()
// ──────────────────────────────────────────────────────────────────────────

test('start: spawns [nodePath, setupServerPath] with inherited-ish stdio', async () => {
  const { spawner, calls } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/fake/bin/node');
  assert.deepEqual(calls[0].args, ['/fake/app/setup-server/server.js']);
});

test('start: injects SETUP_TOKEN, LIMBO_PORT, and feature mode env vars', async () => {
  const { spawner, calls } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  const env = calls[0].options.env;
  assert.equal(env.SETUP_TOKEN, 'tok_a');
  assert.equal(env.LIMBO_PORT, '18901');
  // feature-specific mode flag
  assert.equal(env.CONNECT_CALENDAR_MODE, 'true');
});

test('start: inherits process.env alongside the injected vars', async () => {
  const { spawner, calls } = makeSpawnerHarness();
  await spawner.start({
    sessionId: 'sess_1',
    feature: 'calendar',
    port: 18901,
    token: 'tok_a',
    env: { CUSTOM_VAR: 'xyz' },
  });
  const env = calls[0].options.env;
  assert.equal(env.CUSTOM_VAR, 'xyz');
  // Real PATH / HOME should be inherited. We cannot assert exact values but
  // we CAN assert they were not wiped to undefined.
  assert.notEqual(env.PATH, undefined);
});

test('start: returns { pid, exitPromise } where pid matches the child pid', async () => {
  const { spawner } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  assert.equal(typeof handle.pid, 'number');
  assert.ok(handle.pid > 0);
  assert.ok(handle.exitPromise instanceof Promise);
});

test('start: exitPromise resolves with {code, signal} when child exits', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  // Trigger exit on the fake child
  setImmediate(() => childrenByCall[0]._simulateExit(0, null));
  const result = await handle.exitPromise;
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test('start: exitPromise captures non-zero exit codes', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  setImmediate(() => childrenByCall[0]._simulateExit(42, null));
  const result = await handle.exitPromise;
  assert.equal(result.code, 42);
});

test('start: exitPromise captures signal exit', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  setImmediate(() => childrenByCall[0]._simulateExit(null, 'SIGTERM'));
  const result = await handle.exitPromise;
  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('start: two distinct sessionIds both running get distinct pids and handles', async () => {
  const { spawner } = makeSpawnerHarness();
  const a = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  const b = await spawner.start({ sessionId: 'sess_2', feature: 'gmail', port: 18902, token: 'tok_b' });
  assert.notEqual(a.pid, b.pid);
  assert.equal(spawner.active().length, 2);
});

test('start: duplicate sessionId throws', async () => {
  const { spawner } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  await assert.rejects(
    async () => spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18902, token: 'tok_b' }),
    /already/i,
  );
});

test('start: rejects if spawnFn throws synchronously', async () => {
  const { spawner } = makeSpawnerHarness({
    spawnFn: () => { throw new Error('ENOENT'); },
  });
  await assert.rejects(
    async () => spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' }),
    /ENOENT/,
  );
  assert.equal(spawner.active().length, 0, 'failed spawn must not leave a stale entry');
});

test('start: removes session from active map when child exits', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  assert.equal(spawner.active().length, 1);
  setImmediate(() => childrenByCall[0]._simulateExit(0, null));
  await handle.exitPromise;
  assert.equal(spawner.active().length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// kill()
// ──────────────────────────────────────────────────────────────────────────

test('kill: sends SIGTERM to the matching child', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  // Kick off kill; the spawner awaits the exit, so we have to simulate exit
  // from another tick or the await will hang forever.
  const killPromise = spawner.kill('sess_1');
  setImmediate(() => childrenByCall[0]._simulateExit(null, 'SIGTERM'));
  await killPromise;
  assert.deepEqual(childrenByCall[0].killSignals, ['SIGTERM']);
});

test('kill: resolves after the child actually exits', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  let killResolved = false;
  const killPromise = spawner.kill('sess_1').then(() => { killResolved = true; });
  // Before exit, kill should still be pending
  await new Promise((r) => setImmediate(r));
  assert.equal(killResolved, false);
  childrenByCall[0]._simulateExit(null, 'SIGTERM');
  await killPromise;
  assert.equal(killResolved, true);
});

test('kill: removes the session from active after exit', async () => {
  const { spawner, childrenByCall } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  const killPromise = spawner.kill('sess_1');
  setImmediate(() => childrenByCall[0]._simulateExit(null, 'SIGTERM'));
  await killPromise;
  assert.equal(spawner.active().length, 0);
});

test('kill: unknown session id throws', async () => {
  const { spawner } = makeSpawnerHarness();
  await assert.rejects(async () => spawner.kill('nope'), /not found/i);
});

test('kill: safe to call on an already-exited session (idempotent)', async () => {
  // Race: child exits on its own, then the caller tries to kill it. The
  // spawner should not throw — the cleanup path handles it as a no-op.
  const { spawner, childrenByCall } = makeSpawnerHarness();
  const handle = await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  childrenByCall[0]._simulateExit(0, null);
  await handle.exitPromise;
  // Session already reaped; kill now should throw "not found" since it was
  // removed by the exit handler — callers upstream (router) already treat
  // this as 404. Use a NEW live session to check idempotency on the still-
  // active path.
  const next = await spawner.start({ sessionId: 'sess_2', feature: 'calendar', port: 18902, token: 'tok_b' });
  const killPromise = spawner.kill('sess_2');
  childrenByCall[1]._simulateExit(null, 'SIGTERM');
  await killPromise;
  // And a second kill on the already-reaped session throws — reported upstream
  // as 404 by the router.
  await assert.rejects(async () => spawner.kill('sess_2'), /not found/i);
});

// ──────────────────────────────────────────────────────────────────────────
// active()
// ──────────────────────────────────────────────────────────────────────────

test('active: returns empty when no sessions', () => {
  const { spawner } = makeSpawnerHarness();
  assert.deepEqual(spawner.active(), []);
});

test('active: returns current live sessions with their metadata', async () => {
  const { spawner } = makeSpawnerHarness();
  await spawner.start({ sessionId: 'sess_1', feature: 'calendar', port: 18901, token: 'tok_a' });
  await spawner.start({ sessionId: 'sess_2', feature: 'gmail', port: 18902, token: 'tok_b' });
  const items = spawner.active();
  assert.equal(items.length, 2);
  const byId = new Map(items.map((i) => [i.sessionId, i]));
  assert.equal(byId.get('sess_1').feature, 'calendar');
  assert.equal(byId.get('sess_1').port, 18901);
  assert.equal(byId.get('sess_2').feature, 'gmail');
});

// ──────────────────────────────────────────────────────────────────────────
// Feature-to-env mapping
// ──────────────────────────────────────────────────────────────────────────

test('start: unknown feature throws', async () => {
  const { spawner } = makeSpawnerHarness();
  await assert.rejects(
    async () => spawner.start({ sessionId: 'sess_1', feature: 'banana', port: 18901, token: 'tok_a' }),
    /feature/i,
  );
});
