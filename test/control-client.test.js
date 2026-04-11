/**
 * Integration tests for the control-plane HTTP client.
 *
 * The client is the host-side counterpart to control-server: it speaks HTTP
 * over a TCP loopback port. Tests spin up a real control-server backed by
 * the real session-store + router so the client exercises the full request
 * path (parse → route → response → parse on client side).
 *
 * The control-server and session-store are both already tested at the unit
 * level; these tests focus on the client's parsing, error surfacing, and
 * connection-level behavior.
 *
 * Run: node --test test/control-client.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStore } = require('../lib/session-store');
const { createControlRouter } = require('../lib/control-router');
const { createControlServer } = require('../lib/control-server');
const { createControlClient } = require('../lib/control-client');

// ──────────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────────

async function makeBackend(opts = {}) {
  let idSeed = 0;
  const store = createSessionStore({
    clock: () => 1_000_000,
    idGenerator: () => `sess_${++idSeed}`,
  });
  const handlers = {
    onWizardRequested: opts.onWizardRequested || (async () => ({ port: 18901, token: 'tok_test' })),
    onWizardCancelled: opts.onWizardCancelled || (async () => {}),
  };
  const router = createControlRouter({ store, handlers });
  // Ephemeral port. Parallel-safe.
  const server = createControlServer({ router, port: 0 });
  await server.start();
  const client = createControlClient({ port: server.port });
  return { server, store, client, port: server.port };
}

// ──────────────────────────────────────────────────────────────────────────
// requestWizard
// ──────────────────────────────────────────────────────────────────────────

test('requestWizard: returns parsed session object on success', async () => {
  const { server, client } = await makeBackend();
  try {
    const session = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    assert.equal(session.feature, 'calendar');
    assert.equal(session.status, 'ready');
    assert.equal(session.port, 18901);
    assert.equal(session.token, 'tok_test');
    assert.ok(session.id);
  } finally {
    await server.stop();
  }
});

test('requestWizard: rejects with descriptive error on 400', async () => {
  const { server, client } = await makeBackend();
  try {
    await assert.rejects(
      async () => client.requestWizard({}),
      (err) => /feature/i.test(err.message) && err.status === 400,
    );
  } finally {
    await server.stop();
  }
});

test('requestWizard: rejects with descriptive error on 500', async () => {
  const { server, client } = await makeBackend({
    onWizardRequested: async () => { throw new Error('spawn failed: ENOENT'); },
  });
  try {
    await assert.rejects(
      async () => client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 }),
      (err) => /spawn failed/i.test(err.message) && err.status === 500,
    );
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// getWizard
// ──────────────────────────────────────────────────────────────────────────

test('getWizard: returns parsed session for known id', async () => {
  const { server, client } = await makeBackend();
  try {
    const created = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    const fetched = await client.getWizard(created.id);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.feature, 'calendar');
  } finally {
    await server.stop();
  }
});

test('getWizard: rejects with 404 for unknown id', async () => {
  const { server, client } = await makeBackend();
  try {
    await assert.rejects(
      async () => client.getWizard('does-not-exist'),
      (err) => err.status === 404,
    );
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// cancelWizard
// ──────────────────────────────────────────────────────────────────────────

test('cancelWizard: resolves on 204', async () => {
  const { server, client } = await makeBackend();
  try {
    const created = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    const result = await client.cancelWizard(created.id);
    assert.equal(result, undefined);
  } finally {
    await server.stop();
  }
});

test('cancelWizard: rejects with 404 for unknown id', async () => {
  const { server, client } = await makeBackend();
  try {
    await assert.rejects(
      async () => client.cancelWizard('nope'),
      (err) => err.status === 404,
    );
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// health
// ──────────────────────────────────────────────────────────────────────────

test('health: returns {ok, activeSessions}', async () => {
  const { server, client } = await makeBackend();
  try {
    const h = await client.health();
    assert.equal(h.ok, true);
    assert.equal(typeof h.activeSessions, 'number');
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Connection-level errors
// ──────────────────────────────────────────────────────────────────────────

test('requestWizard: rejects when no server is listening on the port', async () => {
  // Pick a port that is (almost certainly) not in use. We cannot guarantee
  // this without binding and immediately releasing, but 1 is root-only on
  // macOS/Linux so user-space tests get ECONNREFUSED deterministically.
  const client = createControlClient({ port: 1 });
  await assert.rejects(
    async () => client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 }),
    (err) => /ECONNREFUSED|EACCES|EPERM/.test(err.code || err.message || ''),
  );
});

test('requestWizard: rejects when the server is down mid-request', async () => {
  const { server, port } = await makeBackend();
  const client = createControlClient({ port });
  await server.stop();
  await assert.rejects(
    async () => client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 }),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end roundtrip
// ──────────────────────────────────────────────────────────────────────────

test('full lifecycle: request, poll, cancel', async () => {
  const { server, client } = await makeBackend();
  try {
    const session = await client.requestWizard({ feature: 'calendar', timeoutMs: 900_000 });
    const polled = await client.getWizard(session.id);
    assert.equal(polled.status, 'ready');
    await client.cancelWizard(session.id);
    await assert.rejects(
      async () => client.getWizard(session.id),
      (err) => err.status === 404,
    );
  } finally {
    await server.stop();
  }
});
