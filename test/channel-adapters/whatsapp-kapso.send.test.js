'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { createWhatsAppKapsoAdapter } = require('../../lib/channel-adapters/whatsapp-kapso');

/**
 * Stand up a local HTTP server that records incoming requests and lets each
 * test decide what to respond with. Returns { url, close(), last(), responses }.
 */
async function makeMockKapso({ status = 200, body = { messages: [{ id: 'wamid.REPLY1' }] } } = {}) {
  const received = [];
  const responder = { status, body };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      res.statusCode = responder.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responder.body));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    setResponse(next) {
      responder.status = next.status ?? 200;
      responder.body = next.body ?? responder.body;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function makeAdapter(baseUrl) {
  return createWhatsAppKapsoAdapter({
    apiKey: 'test-kapso-api-key',
    phoneNumberId: '15556665544',
    baseUrl,
  });
}

test('send() posts text message to the Kapso Meta-compat endpoint with X-API-Key header', async () => {
  const mock = await makeMockKapso();
  try {
    const adapter = makeAdapter(mock.url);
    const result = await adapter.send({ to: '+5491123456789', text: 'hola tomas' });

    assert.strictEqual(mock.received.length, 1);
    const req = mock.received[0];
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.path, '/meta/whatsapp/v24.0/15556665544/messages');
    assert.strictEqual(req.headers['x-api-key'], 'test-kapso-api-key');
    assert.strictEqual(req.headers['content-type'], 'application/json');
    assert.deepStrictEqual(req.body, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5491123456789',
      type: 'text',
      text: { body: 'hola tomas' },
    });
    assert.strictEqual(result.messageId, 'wamid.REPLY1');
  } finally {
    await mock.close();
  }
});

test('send() splits messages longer than 4096 chars into multiple sends', async () => {
  const mock = await makeMockKapso();
  // Two distinct ids so the assertion below can verify both were sent.
  let n = 0;
  mock.setResponse({ body: { messages: [{ id: 'first' }] } });
  const originalClose = mock.close;
  try {
    const adapter = makeAdapter(mock.url);
    // The mock returns the same body for every call; read .received to check split.
    const long = 'A'.repeat(4096) + 'B'.repeat(1000); // 5096 chars
    await adapter.send({ to: '+5491123456789', text: long });
    assert.strictEqual(mock.received.length, 2, 'expected two send calls');
    assert.strictEqual(mock.received[0].body.text.body.length, 4096);
    assert.strictEqual(mock.received[1].body.text.body.length, 1000);
  } finally {
    await originalClose.call(mock);
  }
});

test('send() surfaces non-2xx Kapso responses as thrown errors with status', async () => {
  const mock = await makeMockKapso({ status: 401, body: { error: 'invalid_api_key' } });
  try {
    const adapter = makeAdapter(mock.url);
    await assert.rejects(
      () => adapter.send({ to: '+5491123456789', text: 'hola' }),
      (err) => /401/.test(err.message) && /invalid_api_key/.test(err.message),
    );
  } finally {
    await mock.close();
  }
});

test('send() rejects with a clear error when the network is unreachable', async () => {
  // Use a port nothing is listening on.
  const adapter = makeAdapter('http://127.0.0.1:1');
  await assert.rejects(
    () => adapter.send({ to: '+5491123456789', text: 'hola' }),
    (err) => err instanceof Error,
  );
});

test('send() rejects on empty text', async () => {
  const mock = await makeMockKapso();
  try {
    const adapter = makeAdapter(mock.url);
    await assert.rejects(
      () => adapter.send({ to: '+5491123456789', text: '' }),
      /text/i,
    );
    assert.strictEqual(mock.received.length, 0, 'no request should have been made');
  } finally {
    await mock.close();
  }
});

test('send() rejects on missing "to"', async () => {
  const mock = await makeMockKapso();
  try {
    const adapter = makeAdapter(mock.url);
    await assert.rejects(
      () => adapter.send({ to: '', text: 'hola' }),
      /to/i,
    );
  } finally {
    await mock.close();
  }
});
