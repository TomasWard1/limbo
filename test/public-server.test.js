/**
 * Tests for the public-facing HTTP server (lib/public-server.js).
 *
 * Spins up real HTTP listeners on ephemeral ports. Tests cover:
 *   - Static page served when no wizard target is set
 *   - Proxy mode when wizard target is set
 *   - clearWizardTarget reverts to static page
 *   - Start/stop lifecycle
 *
 * Run: node --test test/public-server.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createPublicServer } = require('../lib/public-server');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Start a public server on an ephemeral port, return { server, port } */
async function makeServer() {
  const server = createPublicServer({ port: 0 });
  await server.start();
  return { server, port: server.port };
}

/** Minimal HTTP client — returns { status, headers, body: string } */
function get(port, path = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Spin up a tiny HTTP server to act as the wizard target.
 * Responds with wizardBody on all requests.
 */
async function makeWizardServer(wizardBody = 'wizard-response') {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(wizardBody);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test('start: binds a port and exposes it via server.port', async () => {
  const { server, port } = await makeServer();
  try {
    assert.ok(typeof port === 'number' && port > 0, 'server.port must be a positive number after start');
  } finally {
    await server.stop();
  }
});

test('start: throws if called twice on the same instance', async () => {
  const { server } = await makeServer();
  try {
    await assert.rejects(async () => server.start(), /already/i);
  } finally {
    await server.stop();
  }
});

test('stop: closes the listener', async () => {
  const { server, port } = await makeServer();
  await server.stop();
  await assert.rejects(
    async () => get(port),
    (err) => err.code === 'ECONNREFUSED'
  );
});

test('stop: is idempotent (safe to call twice)', async () => {
  const { server } = await makeServer();
  await server.stop();
  await server.stop(); // must not throw
});

test('createPublicServer: throws on invalid port', () => {
  assert.throws(() => createPublicServer({ port: -1 }), /port/i);
  assert.throws(() => createPublicServer({ port: 99999 }), /port/i);
});

// ── Static page ───────────────────────────────────────────────────────────────

test('no wizard target: serves static HTML page with 200', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await get(port);
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].startsWith('text/html'), 'content-type should be text/html');
    assert.ok(res.body.includes('<h1>Limbo</h1>'), 'body should contain Limbo heading');
    assert.ok(res.body.includes('WhatsApp'), 'body should mention WhatsApp');
  } finally {
    await server.stop();
  }
});

test('no wizard target: any path returns the static page', async () => {
  const { server, port } = await makeServer();
  try {
    const res = await get(port, '/some/arbitrary/path');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('<h1>Limbo</h1>'));
  } finally {
    await server.stop();
  }
});

// ── Proxy mode ────────────────────────────────────────────────────────────────

test('wizard target set: proxies requests to the wizard', async () => {
  const { server, port } = await makeServer();
  const wizard = await makeWizardServer('hello-from-wizard');
  try {
    server.setWizardTarget(wizard.port);
    const res = await get(port);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'hello-from-wizard');
  } finally {
    await server.stop();
    await wizard.close();
  }
});

test('wizard target set: proxies the path through to the wizard', async () => {
  let receivedPath = null;
  const wizardServer = http.createServer((req, res) => {
    receivedPath = req.url;
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((resolve) => wizardServer.listen(0, '127.0.0.1', resolve));
  const wizardPort = wizardServer.address().port;

  const { server, port } = await makeServer();
  try {
    server.setWizardTarget(wizardPort);
    await get(port, '/auth/google/callback?code=abc');
    assert.equal(receivedPath, '/auth/google/callback?code=abc');
  } finally {
    await server.stop();
    await new Promise((r) => wizardServer.close(r));
  }
});

test('wizard unreachable: returns 502', async () => {
  const { server, port } = await makeServer();
  try {
    // Point at a port nothing is listening on
    server.setWizardTarget(1); // port 1 is always refused
    const res = await get(port);
    assert.equal(res.status, 502);
  } finally {
    await server.stop();
  }
});

// ── clearWizardTarget ─────────────────────────────────────────────────────────

test('clearWizardTarget: reverts to static page', async () => {
  const { server, port } = await makeServer();
  const wizard = await makeWizardServer('wizard-content');
  try {
    server.setWizardTarget(wizard.port);
    const proxied = await get(port);
    assert.equal(proxied.body, 'wizard-content');

    server.clearWizardTarget();
    const static_ = await get(port);
    assert.equal(static_.status, 200);
    assert.ok(static_.body.includes('<h1>Limbo</h1>'));
  } finally {
    await server.stop();
    await wizard.close();
  }
});
