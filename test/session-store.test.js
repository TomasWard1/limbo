/**
 * Unit tests for the wizard session store.
 *
 * The session store is an in-memory map of active wizard sessions with TTL
 * semantics. It backs the control-server's /wizard endpoints. Pure data
 * structure: no I/O, no HTTP, no filesystem. Time and IDs are injectable so
 * every behaviour can be tested deterministically.
 *
 * State machine a session can be in:
 *
 *     pending → ready → active → done
 *                    ↘        ↘
 *                     error    timeout
 *
 * Only pending/ready/active are "live" states. Once a session reaches
 * done/error/timeout it is terminal and its fields are frozen.
 *
 * Run: node --test test/session-store.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStore } = require('../lib/session-store');

// ──────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────

function makeClock(initial = 0) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (ms) => { now = ms; },
  };
}

function makeIdGen(seed = 0) {
  let n = seed;
  return () => `sess_${++n}`;
}

function makeStore(opts = {}) {
  const clock = opts.clock || makeClock();
  const idGen = opts.idGen || makeIdGen();
  const store = createSessionStore({
    clock: clock.now,
    idGenerator: idGen,
  });
  return { store, clock, idGen };
}

// ──────────────────────────────────────────────────────────────────────────
// create
// ──────────────────────────────────────────────────────────────────────────

test('create: returns session with injected id, feature, and pending status', () => {
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 900000 });
  assert.equal(s.id, 'sess_1');
  assert.equal(s.feature, 'calendar');
  assert.equal(s.status, 'pending');
  assert.equal(s.timeoutMs, 900000);
});

test('create: sets createdAt and expiresAt from injected clock', () => {
  const clock = makeClock(1_000_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  assert.equal(s.createdAt, 1_000_000);
  assert.equal(s.expiresAt, 1_060_000);
});

test('create: sequential calls get distinct ids', () => {
  const { store } = makeStore();
  const a = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const b = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  assert.notEqual(a.id, b.id);
});

test('create: rejects missing feature', () => {
  const { store } = makeStore();
  assert.throws(() => store.create({ timeoutMs: 60_000 }), /feature/i);
});

test('create: rejects non-positive timeoutMs', () => {
  const { store } = makeStore();
  assert.throws(() => store.create({ feature: 'calendar', timeoutMs: 0 }), /timeout/i);
  assert.throws(() => store.create({ feature: 'calendar', timeoutMs: -1 }), /timeout/i);
  assert.throws(() => store.create({ feature: 'calendar' }), /timeout/i);
});

// ──────────────────────────────────────────────────────────────────────────
// get
// ──────────────────────────────────────────────────────────────────────────

test('get: returns the session by id', () => {
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const got = store.get(s.id);
  assert.equal(got.id, s.id);
  assert.equal(got.feature, 'calendar');
});

test('get: returns null for unknown id', () => {
  const { store } = makeStore();
  assert.equal(store.get('does-not-exist'), null);
});

test('get: returns frozen/cloned object (mutations do not leak)', () => {
  // The store is the source of truth. A caller should not be able to mutate
  // internal state by mutating a returned session object.
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const got = store.get(s.id);
  try { got.status = 'HACKED'; } catch {}
  assert.notEqual(store.get(s.id).status, 'HACKED');
});

// ──────────────────────────────────────────────────────────────────────────
// expiry: pending/ready session past expiresAt surfaces as 'timeout'
// ──────────────────────────────────────────────────────────────────────────

test('get: a live session past expiresAt surfaces as timeout', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  assert.equal(store.get(s.id).status, 'pending');
  clock.advance(101);
  assert.equal(store.get(s.id).status, 'timeout');
});

test('get: a done session is never overridden by timeout (terminal wins)', () => {
  // Terminal states (done/error) must never regress to timeout just because
  // the caller is slow to poll.
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  store.update(s.id, { status: 'done' });
  clock.advance(10_000); // well past expiresAt
  assert.equal(store.get(s.id).status, 'done');
});

test('get: an error session is never overridden by timeout', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  store.update(s.id, { status: 'error', error: 'boom' });
  clock.advance(10_000);
  assert.equal(store.get(s.id).status, 'error');
});

// ──────────────────────────────────────────────────────────────────────────
// update
// ──────────────────────────────────────────────────────────────────────────

test('update: transitions status and merges fields', () => {
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  store.update(s.id, { status: 'ready', port: 18901, token: 'tok_xyz' });
  const got = store.get(s.id);
  assert.equal(got.status, 'ready');
  assert.equal(got.port, 18901);
  assert.equal(got.token, 'tok_xyz');
  // Unchanged fields preserved
  assert.equal(got.feature, 'calendar');
});

test('update: unknown session throws', () => {
  const { store } = makeStore();
  assert.throws(() => store.update('nope', { status: 'ready' }), /not found/i);
});

test('update: rejects illegal status transitions', () => {
  // pending → done is allowed (e.g. wizard aborted early)
  // done → anything is rejected (terminal)
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  store.update(s.id, { status: 'done' });
  assert.throws(() => store.update(s.id, { status: 'ready' }), /terminal/i);
  assert.throws(() => store.update(s.id, { status: 'active' }), /terminal/i);
});

test('update: rejects unknown status values', () => {
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  assert.throws(() => store.update(s.id, { status: 'banana' }), /status/i);
});

test('update: setting terminal status freezes expiresAt behaviour', () => {
  // After update to done, even a stale clock should not cause timeout surfacing.
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  clock.advance(50);
  store.update(s.id, { status: 'done' });
  clock.advance(10_000);
  assert.equal(store.get(s.id).status, 'done');
});

// ──────────────────────────────────────────────────────────────────────────
// remove
// ──────────────────────────────────────────────────────────────────────────

test('remove: drops the session and returns it', () => {
  const { store } = makeStore();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const removed = store.remove(s.id);
  assert.equal(removed.id, s.id);
  assert.equal(store.get(s.id), null);
});

test('remove: unknown id returns null', () => {
  const { store } = makeStore();
  assert.equal(store.remove('nope'), null);
});

// ──────────────────────────────────────────────────────────────────────────
// list
// ──────────────────────────────────────────────────────────────────────────

test('list: empty when no sessions', () => {
  const { store } = makeStore();
  assert.deepEqual(store.list(), []);
});

test('list: returns all sessions (with timeout surfaced for expired live ones)', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const a = store.create({ feature: 'calendar', timeoutMs: 100 });
  const b = store.create({ feature: 'gmail', timeoutMs: 10_000 });
  clock.advance(200);
  const items = store.list();
  assert.equal(items.length, 2);
  const byId = new Map(items.map((s) => [s.id, s]));
  assert.equal(byId.get(a.id).status, 'timeout');
  assert.equal(byId.get(b.id).status, 'pending');
});

test('list: does not leak mutations back to the store', () => {
  const { store } = makeStore();
  store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const items = store.list();
  try { items[0].status = 'HACKED'; } catch {}
  assert.notEqual(store.list()[0].status, 'HACKED');
});

// ──────────────────────────────────────────────────────────────────────────
// cleanup (physically remove terminal/expired sessions older than grace)
// ──────────────────────────────────────────────────────────────────────────

test('cleanup: removes sessions whose terminal state is older than graceMs', () => {
  // After a session is done/error/timeout, keep it around briefly so the CLI
  // can poll final status once, then reap it. graceMs controls the window.
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  store.update(s.id, { status: 'done' });
  // Just finished — cleanup should NOT remove it yet
  const removed1 = store.cleanup({ graceMs: 5_000 });
  assert.equal(removed1.length, 0);
  assert.notEqual(store.get(s.id), null);
  // Advance past grace → now it should be reaped
  clock.advance(6_000);
  const removed2 = store.cleanup({ graceMs: 5_000 });
  assert.equal(removed2.length, 1);
  assert.equal(removed2[0].id, s.id);
  assert.equal(store.get(s.id), null);
});

test('cleanup: does not reap live sessions (pending/ready/active)', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  store.create({ feature: 'calendar', timeoutMs: 60_000 });
  clock.advance(60_000); // session is still within expiresAt (60s timeout from t=1000)
  assert.equal(store.list()[0].status, 'pending');
  const removed = store.cleanup({ graceMs: 0 });
  assert.equal(removed.length, 0);
});

test('cleanup: reaps timed-out sessions after grace', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  clock.advance(200); // past expiresAt → surfaces as timeout
  assert.equal(store.get(s.id).status, 'timeout');
  clock.advance(5_000); // past grace
  const removed = store.cleanup({ graceMs: 1_000 });
  assert.equal(removed.length, 1);
  assert.equal(removed[0].id, s.id);
});

test('cleanup: is idempotent', () => {
  const clock = makeClock(1_000);
  const { store } = makeStore({ clock });
  const s = store.create({ feature: 'calendar', timeoutMs: 100 });
  clock.advance(10_000);
  store.cleanup({ graceMs: 0 });
  const second = store.cleanup({ graceMs: 0 });
  assert.deepEqual(second, []);
  assert.equal(store.get(s.id), null);
});

// ──────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────

test('createSessionStore: default clock uses Date.now if not injected', () => {
  // Should not throw when called without injection (for production use).
  const { createSessionStore: create } = require('../lib/session-store');
  const store = create();
  const before = Date.now();
  const s = store.create({ feature: 'calendar', timeoutMs: 60_000 });
  const after = Date.now();
  assert.ok(s.createdAt >= before && s.createdAt <= after);
  assert.ok(typeof s.id === 'string' && s.id.length > 0);
});
