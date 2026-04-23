'use strict';

/**
 * Tests for the `channels` wiring on the public server.
 *
 * public-server.js is the only internet-facing surface on a Limbo instance.
 * Webhook-driven channel adapters plug in here via the optional `channels`
 * config passed to createPublicServer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createPublicServer } = require('../lib/public-server');

function postJson(port, path, body, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitFor(condition, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('POST /channel/whatsapp invokes the handler and returns 200 immediately', async () => {
  const received = [];
  const channels = {
    whatsapp: {
      onInbound: async (payload, headers) => {
        received.push({ payload, headers });
      },
    },
  };
  const server = createPublicServer({ port: 0, channels });
  await server.start();
  try {
    const body = { type: 'message.received', data: [] };
    const res = await postJson(server.port, '/channel/whatsapp', body);
    assert.equal(res.status, 200);
    await waitFor(() => received.length === 1);
    assert.deepStrictEqual(received[0].payload, body);
  } finally {
    await server.stop();
  }
});

test('POST /channel/whatsapp with no channels config returns 404', async () => {
  const server = createPublicServer({ port: 0 });
  await server.start();
  try {
    const res = await postJson(server.port, '/channel/whatsapp', { type: 'x' });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
});

test('POST /channel/whatsapp with invalid JSON returns 400', async () => {
  const received = [];
  const channels = {
    whatsapp: {
      onInbound: async (payload) => received.push(payload),
    },
  };
  const server = createPublicServer({ port: 0, channels });
  await server.start();
  try {
    const res = await postJson(server.port, '/channel/whatsapp', '{not-json}');
    assert.equal(res.status, 400);
    assert.equal(received.length, 0);
  } finally {
    await server.stop();
  }
});

test('POST /channel/whatsapp does not block on slow handlers', async () => {
  let handlerFinished = false;
  const channels = {
    whatsapp: {
      onInbound: async () => {
        await new Promise((r) => setTimeout(r, 200));
        handlerFinished = true;
      },
    },
  };
  const server = createPublicServer({ port: 0, channels });
  await server.start();
  try {
    const t0 = Date.now();
    const res = await postJson(server.port, '/channel/whatsapp', { type: 'x', data: [] });
    const ackMs = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.ok(ackMs < 150, `ack should be <150ms even when handler is slow; got ${ackMs}ms`);
    assert.equal(handlerFinished, false, 'handler should still be running when ack arrived');
    await waitFor(() => handlerFinished === true, { timeoutMs: 800 });
  } finally {
    await server.stop();
  }
});

test('GET /channel/whatsapp returns 405 (POST only)', async () => {
  const channels = {
    whatsapp: { onInbound: async () => {} },
  };
  const server = createPublicServer({ port: 0, channels });
  await server.start();
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: server.port, path: '/channel/whatsapp', method: 'GET' },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 405);
  } finally {
    await server.stop();
  }
});

test('/channel/whatsapp is independent of wizard proxy / static page', async () => {
  const received = [];
  const channels = {
    whatsapp: {
      onInbound: async (payload) => received.push(payload),
    },
  };
  const server = createPublicServer({ port: 0, channels });
  await server.start();
  try {
    // Unrelated path still serves static page even when channels are wired.
    const staticRes = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: server.port, path: '/', method: 'GET' },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(staticRes.status, 200);
    assert.ok(staticRes.body.includes('<h1>Limbo</h1>'));

    // Channel route still works.
    const chanRes = await postJson(server.port, '/channel/whatsapp', { type: 'x', data: [] });
    assert.equal(chanRes.status, 200);
    await waitFor(() => received.length === 1);
  } finally {
    await server.stop();
  }
});
