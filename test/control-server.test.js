/**
 * Integration tests for the control-plane HTTP server.
 *
 * Unlike session-store and control-router (which are pure and tested at the
 * unit level), this suite spins up a real http.Server bound to a real unix
 * domain socket in a per-test tmpdir, then makes real HTTP requests over
 * that socket. This validates the HTTP layer end-to-end: request parsing,
 * JSON body handling, response serialization, socket lifecycle.
 *
 * Each test gets its own socket path so they can run in parallel without
 * stepping on each other.
 *
 * Run: node --test test/control-server.test.js
 */

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createSessionStore } = require('../lib/session-store');
const { createControlRouter } = require('../lib/control-router');
const { createControlServer } = require('../lib/control-server');

// ──────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────

let tmpRoot;
before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-control-server-test-'));
});
after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

let socketCounter = 0;
function uniqueSocketPath() {
  socketCounter++;
  return path.join(tmpRoot, `sock-${process.pid}-${socketCounter}.sock`);
}

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
  const socketPath = opts.socketPath || uniqueSocketPath();
  const server = createControlServer({ router, socketPath });
  await server.start();
  return { server, store, router, socketPath };
}

// Minimal unix-socket HTTP client for tests. Returns { status, body } where
// body is the parsed JSON response (or null for 204).
function request({ socketPath, method, path: urlPath, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? '' : JSON.stringify(body);
    const req = http.request({
      socketPath,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
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
function requestRaw({ socketPath, method, path: urlPath, rawBody, contentType }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
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

test('start: creates the unix socket file at the configured path', async () => {
  const { server, socketPath } = await makeServer();
  try {
    assert.ok(fs.existsSync(socketPath), 'socket file should exist after start');
  } finally {
    await server.stop();
  }
});

test('stop: removes the socket file', async () => {
  const { server, socketPath } = await makeServer();
  await server.stop();
  assert.equal(fs.existsSync(socketPath), false);
});

test('start: cleans up stale socket file from previous crashed run', async () => {
  const socketPath = uniqueSocketPath();
  // Simulate a crashed previous server: create a stale regular file at the path.
  fs.writeFileSync(socketPath, 'stale');
  const { server } = await makeServer({ socketPath });
  try {
    // If start() succeeded despite the stale file, it must have removed it.
    // The socket file now exists as an actual socket.
    assert.ok(fs.existsSync(socketPath));
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
// End-to-end HTTP requests
// ──────────────────────────────────────────────────────────────────────────

test('POST /wizard: end-to-end creates session and returns JSON', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const res = await request({
      socketPath, method: 'POST', path: '/wizard',
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
  const { server, socketPath } = await makeServer();
  try {
    const created = await request({
      socketPath, method: 'POST', path: '/wizard',
      body: { feature: 'calendar', timeoutMs: 900_000 },
    });
    const got = await request({
      socketPath, method: 'GET', path: `/wizard/${created.body.id}`,
    });
    assert.equal(got.status, 200);
    assert.equal(got.body.id, created.body.id);
    assert.equal(got.body.feature, 'calendar');
  } finally {
    await server.stop();
  }
});

test('DELETE /wizard/:id: end-to-end cancels session and returns 204 with empty body', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const created = await request({
      socketPath, method: 'POST', path: '/wizard',
      body: { feature: 'calendar', timeoutMs: 900_000 },
    });
    const del = await request({
      socketPath, method: 'DELETE', path: `/wizard/${created.body.id}`,
    });
    assert.equal(del.status, 204);
    assert.equal(del.body, null);
    // Subsequent GET should 404
    const after = await request({
      socketPath, method: 'GET', path: `/wizard/${created.body.id}`,
    });
    assert.equal(after.status, 404);
  } finally {
    await server.stop();
  }
});

test('GET /health: end-to-end returns ok true and session count', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const res = await request({ socketPath, method: 'GET', path: '/health' });
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
  const { server, socketPath } = await makeServer();
  try {
    const res = await requestRaw({
      socketPath, method: 'POST', path: '/wizard',
      rawBody: '{not valid json',
    });
    assert.equal(res.status, 400);
  } finally {
    await server.stop();
  }
});

test('Unknown path returns 404', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const res = await request({ socketPath, method: 'GET', path: '/nonsense' });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
});

test('Method not allowed returns 405', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const res = await request({ socketPath, method: 'PUT', path: '/health' });
    assert.equal(res.status, 405);
  } finally {
    await server.stop();
  }
});

test('Large request body beyond limit returns 413', async () => {
  // Wizard requests are tiny. Anything near the limit is abuse — reject fast
  // instead of buffering arbitrary memory.
  const { server, socketPath } = await makeServer();
  try {
    const big = 'x'.repeat(256 * 1024); // 256KB
    const res = await requestRaw({
      socketPath, method: 'POST', path: '/wizard',
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

test('handles concurrent requests without cross-contamination', async () => {
  const { server, socketPath } = await makeServer();
  try {
    const results = await Promise.all([
      request({ socketPath, method: 'POST', path: '/wizard', body: { feature: 'calendar', timeoutMs: 900_000 } }),
      request({ socketPath, method: 'POST', path: '/wizard', body: { feature: 'gmail', timeoutMs: 900_000 } }),
      request({ socketPath, method: 'POST', path: '/wizard', body: { feature: 'drive', timeoutMs: 900_000 } }),
    ]);
    for (const r of results) assert.equal(r.status, 201);
    const features = results.map((r) => r.body.feature).sort();
    assert.deepEqual(features, ['calendar', 'drive', 'gmail']);
    const ids = new Set(results.map((r) => r.body.id));
    assert.equal(ids.size, 3, 'concurrent POSTs must get distinct session ids');
  } finally {
    await server.stop();
  }
});
