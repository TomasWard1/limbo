/**
 * Unit tests for the control-plane router.
 *
 * The router is a pure function that maps a parsed HTTP request to a response:
 *
 *     router.handle({ method, path, body }) → { status, body }
 *
 * It owns no I/O: the HTTP layer parses the request, the router computes the
 * response, the HTTP layer writes it back. This makes every endpoint testable
 * without opening a socket. The router talks to an injected session store
 * and to injected side-effect handlers (which the real supervisor wires up to
 * spawn/kill the setup-server process).
 *
 * Routes:
 *
 *     POST   /wizard         → create session, call onWizardRequested → 201
 *     GET    /wizard/:id     → read session state                      → 200 | 404
 *     DELETE /wizard/:id     → call onWizardCancelled, mark done       → 204 | 404
 *     GET    /health         → supervisor health snapshot              → 200
 *
 * Anything else is 404. Wrong method on a known path is 405.
 *
 * Run: node --test test/control-router.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStore } = require('../lib/session-store');
const { createControlRouter } = require('../lib/control-router');

// ──────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────

function makeClock(initial = 1_000) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

function makeIdGen(seed = 0) {
  let n = seed;
  return () => `sess_${++n}`;
}

function makeRouter(opts = {}) {
  const clock = opts.clock || makeClock();
  const idGen = opts.idGen || makeIdGen();
  const store = createSessionStore({ clock: clock.now, idGenerator: idGen });

  const calls = { requested: [], cancelled: [] };
  const handlers = {
    onWizardRequested: opts.onWizardRequested || (async ({ feature, session }) => {
      calls.requested.push({ feature, sessionId: session.id });
      return { port: 18901, token: 'tok_default' };
    }),
    onWizardCancelled: opts.onWizardCancelled || (async (session) => {
      calls.cancelled.push(session.id);
    }),
  };

  const router = createControlRouter({ store, handlers });
  return { router, store, clock, calls };
}

// ──────────────────────────────────────────────────────────────────────────
// POST /wizard
// ──────────────────────────────────────────────────────────────────────────

test('POST /wizard: valid body creates session and returns 201 with ready status', async () => {
  const { router, store, calls } = makeRouter();
  const res = await router.handle({
    method: 'POST',
    path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.feature, 'calendar');
  assert.equal(res.body.port, 18901);
  assert.equal(res.body.token, 'tok_default');
  // Handler called with the created session
  assert.equal(calls.requested.length, 1);
  assert.equal(calls.requested[0].feature, 'calendar');
  // Session persisted in store
  const stored = store.get(res.body.id);
  assert.equal(stored.status, 'ready');
  assert.equal(stored.port, 18901);
});

test('POST /wizard: missing feature returns 400', async () => {
  const { router } = makeRouter();
  const res = await router.handle({
    method: 'POST',
    path: '/wizard',
    body: { timeoutMs: 900_000 },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  assert.ok(/feature/i.test(res.body.error));
});

test('POST /wizard: missing timeoutMs returns 400', async () => {
  const { router } = makeRouter();
  const res = await router.handle({
    method: 'POST',
    path: '/wizard',
    body: { feature: 'calendar' },
  });
  assert.equal(res.status, 400);
  assert.ok(/timeout/i.test(res.body.error));
});

test('POST /wizard: null body returns 400', async () => {
  const { router } = makeRouter();
  const res = await router.handle({ method: 'POST', path: '/wizard', body: null });
  assert.equal(res.status, 400);
});

test('POST /wizard: handler failure marks session error and returns 500', async () => {
  const { router, store } = makeRouter({
    onWizardRequested: async () => { throw new Error('spawn failed'); },
  });
  const res = await router.handle({
    method: 'POST',
    path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  assert.equal(res.status, 500);
  assert.ok(res.body.error);
  // Session should still exist in the store with status=error for debugging
  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'error');
});

test('POST /wizard: does not call handler before validation', async () => {
  let called = false;
  const { router } = makeRouter({
    onWizardRequested: async () => { called = true; return { port: 1, token: 't' }; },
  });
  await router.handle({ method: 'POST', path: '/wizard', body: {} });
  assert.equal(called, false);
});

// ──────────────────────────────────────────────────────────────────────────
// GET /wizard/:id
// ──────────────────────────────────────────────────────────────────────────

test('GET /wizard/:id: returns 200 with session state for known id', async () => {
  const { router } = makeRouter();
  const created = await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  const got = await router.handle({
    method: 'GET',
    path: `/wizard/${created.body.id}`,
    body: null,
  });
  assert.equal(got.status, 200);
  assert.equal(got.body.id, created.body.id);
  assert.equal(got.body.status, 'ready');
  assert.equal(got.body.feature, 'calendar');
});

test('GET /wizard/:id: returns 404 for unknown id', async () => {
  const { router } = makeRouter();
  const res = await router.handle({ method: 'GET', path: '/wizard/does-not-exist', body: null });
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test('GET /wizard/:id: surfaces timeout status when poll happens after expiry', async () => {
  const { router, clock } = makeRouter();
  const created = await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 100 },
  });
  // Advance clock past expiry. Even though the handler set status=ready,
  // the session-store surfaces timeout on read because ready is a live state.
  clock.advance(500);
  const got = await router.handle({
    method: 'GET',
    path: `/wizard/${created.body.id}`,
    body: null,
  });
  assert.equal(got.status, 200);
  assert.equal(got.body.status, 'timeout');
});

// ──────────────────────────────────────────────────────────────────────────
// DELETE /wizard/:id
// ──────────────────────────────────────────────────────────────────────────

test('DELETE /wizard/:id: calls cancel handler and returns 204', async () => {
  const { router, calls } = makeRouter();
  const created = await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  const res = await router.handle({
    method: 'DELETE',
    path: `/wizard/${created.body.id}`,
    body: null,
  });
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(calls.cancelled.length, 1);
  assert.equal(calls.cancelled[0], created.body.id);
});

test('DELETE /wizard/:id: unknown id returns 404 and does not call handler', async () => {
  const { router, calls } = makeRouter();
  const res = await router.handle({ method: 'DELETE', path: '/wizard/nope', body: null });
  assert.equal(res.status, 404);
  assert.equal(calls.cancelled.length, 0);
});

test('DELETE /wizard/:id: handler failure still removes session and returns 500', async () => {
  // If the cancel handler throws (e.g. the process is already dead), the
  // router must still remove the session from the store — otherwise we leak
  // zombie state. Return 500 so the caller knows something went wrong.
  const { router, store } = makeRouter({
    onWizardCancelled: async () => { throw new Error('already dead'); },
  });
  const created = await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  const res = await router.handle({
    method: 'DELETE',
    path: `/wizard/${created.body.id}`,
    body: null,
  });
  assert.equal(res.status, 500);
  assert.equal(store.get(created.body.id), null);
});

// ──────────────────────────────────────────────────────────────────────────
// GET /health
// ──────────────────────────────────────────────────────────────────────────

test('GET /health: returns 200 with ok and active session count', async () => {
  const { router } = makeRouter();
  const res = await router.handle({ method: 'GET', path: '/health', body: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.activeSessions, 0);
});

test('GET /health: active session count reflects store state', async () => {
  const { router } = makeRouter();
  await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'gmail', timeoutMs: 900_000 },
  });
  const res = await router.handle({ method: 'GET', path: '/health', body: null });
  assert.equal(res.body.activeSessions, 2);
});

// ──────────────────────────────────────────────────────────────────────────
// Routing edge cases
// ──────────────────────────────────────────────────────────────────────────

test('Unknown path returns 404', async () => {
  const { router } = makeRouter();
  const res = await router.handle({ method: 'GET', path: '/nonsense', body: null });
  assert.equal(res.status, 404);
});

test('Wrong method on known path returns 405', async () => {
  const { router } = makeRouter();
  // PUT /wizard is not a thing
  const res = await router.handle({ method: 'PUT', path: '/wizard', body: {} });
  assert.equal(res.status, 405);
});

test('Wrong method on /wizard/:id returns 405', async () => {
  const { router } = makeRouter();
  const created = await router.handle({
    method: 'POST', path: '/wizard',
    body: { feature: 'calendar', timeoutMs: 900_000 },
  });
  const res = await router.handle({
    method: 'PATCH',
    path: `/wizard/${created.body.id}`,
    body: null,
  });
  assert.equal(res.status, 405);
});

test('Wrong method on /health returns 405', async () => {
  const { router } = makeRouter();
  const res = await router.handle({ method: 'POST', path: '/health', body: {} });
  assert.equal(res.status, 405);
});

test('handle is safe to call concurrently (no shared mutable request state)', async () => {
  const { router } = makeRouter();
  const [a, b] = await Promise.all([
    router.handle({ method: 'POST', path: '/wizard', body: { feature: 'calendar', timeoutMs: 900_000 } }),
    router.handle({ method: 'POST', path: '/wizard', body: { feature: 'gmail', timeoutMs: 900_000 } }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(a.body.feature, 'calendar');
  assert.equal(b.body.feature, 'gmail');
});
