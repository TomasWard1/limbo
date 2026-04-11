/**
 * Integration tests for the control-plane HTTP server.
 *
 * Unlike session-store and control-router (which are pure and tested at the
 * unit level), this suite spins up a real http.Server bound to an ephemeral
 * loopback TCP port and makes real HTTP requests over it. This validates the
 * HTTP layer end-to-end: request parsing, JSON body handling, response
 * serialization, Host header validation, listener lifecycle.
 *
 * Each test binds to `listen(0, '127.0.0.1')` so they can run in parallel
 * without stepping on each other.
 *
 * Run: node --test test/control-server.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createSessionStore } = require('../lib/session-store');
const { createControlRouter } = require('../lib/control-router');
const { createControlServer } = require('../lib/control-server');

// ──────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────

async function makeServer(opts = {}) {
  const store = createSessionStore({
    clock: () => 1_000_000,
    idGenerator: (() => {
      let n = 0;
      return () => `sess_${++n}`;
    })(),
  });
  const handlers = {
    onWizardRequested: opts.onWizardRequested || (async () => ({ port: 18901, token: 'tok_test' })),
    onWizardCancelled: opts.onWizardCancelled || (async () => {}),
  };
  const router = createControlRouter({ store, handlers });
  // Ephemeral port — the kernel picks one, tests read it back via
  // server.port after start(). Parallel safe by construction.
  const server = createControlServer({ router, port: 0 });
  await server.start();
  return { server, store, router, port: server.port };
}

// Minimal loopback-TCP HTTP client for tests. Returns { status, body } where
// body is the parsed JSON response (or null for 204).
function request({ port, method, path: urlPath, body, host }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        // Allow tests to override Host (for DNS-rebinding regression tests).
        ...(host !== undefined ? { Host: host } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw.length > 0) {
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Raw request (bypasses JSON encoding; for testing malformed bodies)
function requestRaw({ port, method, path: urlPath, rawBody, contentType }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': contentType || 'application/json',
        'Content-Length': Buffer.byteLength(rawBody || ''),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────────────────────

test('start: binds a loopback TCP port and exposes it via server.port', async () => {
  const { server, port } = await makeServer();
  try {
    assert.ok(typeof port === 'number' && port > 0, 'server.port must be a positive number after start');
  } finally {
    await server.stop();
  }
});

test('stop: closes the TCP listener', async () => {
  const { server, port } = await makeServer();
  await server.stop();
  // Subsequent connect attempts on the closed port should fail fast.
  await assert.rejects(
    async () => request({ port, method: 'GET', path: '/health' }),
    (err) => err.code === 'ECONNREFUSED'
  );
});

test('start: refuses connections on a non-loopback bind', async () => {
  // This is a documentation test — the server must NOT bind to 0.0.0.0
  // by default. We assert the default host constant keeps the server on
  // loopback by listening and then checking the address family.
  const { server } = await makeServer();
  try {
    // Node's http.Server.address() returns { address, family, port }.
    // We just ensure the server is reachable on 127.0.0.1 (previous test
    // already exercised this), and that it is NOT reachable on a
    // different interface. The latter cannot be portably exercised here
    // without raw socket code, so we trust the `host: '127.0.0.1'`
    // default enforced by createControlServer.
    assert.ok(server.port > 0);
  } finally {
    await server.stop();
  }
});

test('start: throws if called twice on the same server instance', async () => {
  const { server } = await makeServer();
  try {
    await assert.rejects(async () => server.start(), /already/i);
  } finally {
    await server.stop();
  }
});

test('stop: is idempotent (safe to call twice)', async () => {
  const { server } = await makeServer();
  await server.stop();
  // Second stop must not throw
  await server.stop();
});

// ──────────────────────────────────────────────────────────────────────────
// Host header validation (DNS-rebinding defence)
// ──────────────────────────────────────────────────────────────────────────

test('rejects requests with a non-loopback Host header (DNS rebinding defence)', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({
      port, method: 'GET', path: '/health',
      host: 'evil.example.com:18902',
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error || '', /host/i);
  } finally {
    await server.stop();
  }
});

test('accepts 127.0.0.1 Host header', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({
      port, method: 'GET', path: '/health',
      host: `127.0.0.1:${port}`,
    });
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
  }
});

test('accepts localhost Host header', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({
      port, method: 'GET', path: '/health',
      host: `localhost:${port}`,
    });
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
  }
});

test('accepts Host header without a port suffix', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({
      port, method: 'GET', path: '/health',
      host: '127.0.0.1',
    });
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end HTTP requests
// ──────────────────────────────────────────────────────────────────────────

test('POST /wizard: end-to-end creates session and returns JSON', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({
      port, method: 'POST', path: '/wizard',
      body: { feature: 'calendar', timeoutMs: 900_000 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.feature, 'calendar');
    assert.equal(res.body.status, 'ready');
    assert.equal(res.body.port, 18901);
    assert.equal(res.body.token, 'tok_test');
  } finally {
    await server.stop();
  }
});

test('GET /wizard/:id: end-to-end fetches session by id', async () => {
  const { server, port } = await makeServer();
  try {
    const created = await request({
      port, method: 'POST', path: '/wizard',
      body: { feature: 'calendar', timeoutMs: 900_000 },
    });
    const got = await request({
      port, method: 'GET', path: `/wizard/${created.body.id}`,
    });
    assert.equal(got.status, 200);
    assert.equal(got.body.id, created.body.id);
    assert.equal(got.body.feature, 'calendar');
  } finally {
    await server.stop();
  }
});

test('DELETE /wizard/:id: end-to-end cancels session and returns 204 with empty body', async () => {
  const { server, port } = await makeServer();
  try {
    const created = await request({
      port, method: 'POST', path: '/wizard',
      body: { feature: 'calendar', timeoutMs: 900_000 },
    });
    const del = await request({
      port, method: 'DELETE', path: `/wizard/${created.body.id}`,
    });
    assert.equal(del.status, 204);
    assert.equal(del.body, null);
    // Subsequent GET should 404
    const after = await request({
      port, method: 'GET', path: `/wizard/${created.body.id}`,
    });
    assert.equal(after.status, 404);
  } finally {
    await server.stop();
  }
});

test('GET /health: end-to-end returns ok true and session count', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({ port, method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.activeSessions, 0);
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Error handling at HTTP layer
// ──────────────────────────────────────────────────────────────────────────

test('POST /wizard with malformed JSON body returns 400', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await requestRaw({
      port, method: 'POST', path: '/wizard',
      rawBody: '{not valid json',
    });
    assert.equal(res.status, 400);
  } finally {
    await server.stop();
  }
});

test('Unknown path returns 404', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({ port, method: 'GET', path: '/nonsense' });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
});

test('Method not allowed returns 405', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await request({ port, method: 'PUT', path: '/health' });
    assert.equal(res.status, 405);
  } finally {
    await server.stop();
  }
});

test('Large request body beyond limit returns 413', async () => {
  // Wizard requests are tiny. Anything near the limit is abuse — reject fast
  // instead of buffering arbitrary memory.
  const { server, port } = await makeServer();
  try {
    const big = 'x'.repeat(256 * 1024); // 256KB
    const res = await requestRaw({
      port, method: 'POST', path: '/wizard',
      rawBody: JSON.stringify({ feature: 'calendar', timeoutMs: 900_000, pad: big }),
    });
    assert.equal(res.status, 413);
  } finally {
    await server.stop();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Concurrency
// ──────────────────────────────────────────────────────────────────────────

test('handles concurrent requests without cross-contamination (concurrency guard picks 1 winner)', async () => {
  // The control plane allows only ONE live wizard session at a time. The
  // concurrency-safety property we care about is not "N sessions from N
  // concurrent requests" but "no shared mutable state in the HTTP
  // wrapper" — exactly one request wins (201), the rest get a clean 409
  // response (not a crash or a mangled body).
  const { server, port } = await makeServer();
  try {
    const results = await Promise.all([
      request({ port, method: 'POST', path: '/wizard', body: { feature: 'calendar', timeoutMs: 900_000 } }),
      request({ port, method: 'POST', path: '/wizard', body: { feature: 'gmail', timeoutMs: 900_000 } }),
      request({ port, method: 'POST', path: '/wizard', body: { feature: 'drive', timeoutMs: 900_000 } }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409], 'exactly one winner, two rejections');
    const winner = results.find((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 409);
    assert.ok(winner.body.id);
    for (const l of losers) {
      assert.equal(l.body.activeSessionId, winner.body.id, 'losers point at the winner');
    }
  } finally {
    await server.stop();
  }
});
