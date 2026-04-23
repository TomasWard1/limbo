'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { sendChat } = require('../lib/openclaw-client');

/**
 * Tiny OpenClaw gateway mock. Records requests, lets each test configure its
 * response.
 */
async function makeMockGateway({ status = 200, body = {} } = {}) {
  const received = [];
  const responder = {
    status,
    body,
    delayMs: 0,
  };

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
      const respond = () => {
        res.statusCode = responder.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(responder.body));
      };
      if (responder.delayMs > 0) {
        setTimeout(respond, responder.delayMs);
      } else {
        respond();
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    setResponse(next) {
      Object.assign(responder, next);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function chatCompletionResponse(content) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1746822000,
    model: 'openclaw/default',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  };
}

test('sendChat posts to /v1/chat/completions with the provided bearer token', async () => {
  const mock = await makeMockGateway({ body: chatCompletionResponse('hola tomas') });
  try {
    const reply = await sendChat({
      gatewayUrl: mock.url,
      token: 'test-gateway-token',
      user: '+5491123456789',
      text: 'hola',
    });

    assert.strictEqual(mock.received.length, 1);
    const req = mock.received[0];
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.path, '/v1/chat/completions');
    assert.strictEqual(req.headers.authorization, 'Bearer test-gateway-token');
    assert.strictEqual(req.headers['content-type'], 'application/json');
    assert.strictEqual(req.body.user, '+5491123456789');
    assert.strictEqual(req.body.model, 'openclaw/default');
    assert.strictEqual(req.body.stream, false);
    assert.deepStrictEqual(req.body.messages, [{ role: 'user', content: 'hola' }]);
    assert.strictEqual(reply, 'hola tomas');
  } finally {
    await mock.close();
  }
});

test('sendChat uses an overridden model when provided', async () => {
  const mock = await makeMockGateway({ body: chatCompletionResponse('ok') });
  try {
    await sendChat({
      gatewayUrl: mock.url,
      token: 't',
      user: 'u',
      text: 'x',
      model: 'openclaw/alternate',
    });
    assert.strictEqual(mock.received[0].body.model, 'openclaw/alternate');
  } finally {
    await mock.close();
  }
});

test('sendChat surfaces non-2xx gateway responses as Error with status + body', async () => {
  const mock = await makeMockGateway({
    status: 503,
    body: { error: 'backend_overloaded' },
  });
  try {
    await assert.rejects(
      () => sendChat({ gatewayUrl: mock.url, token: 't', user: 'u', text: 'x' }),
      (err) => /503/.test(err.message) && /backend_overloaded/.test(err.message),
    );
  } finally {
    await mock.close();
  }
});

test('sendChat rejects when response has no choices[0].message.content', async () => {
  const mock = await makeMockGateway({ body: { choices: [] } });
  try {
    await assert.rejects(
      () => sendChat({ gatewayUrl: mock.url, token: 't', user: 'u', text: 'x' }),
      /content/i,
    );
  } finally {
    await mock.close();
  }
});

test('sendChat times out when the gateway takes too long', async () => {
  const mock = await makeMockGateway({ body: chatCompletionResponse('late') });
  mock.setResponse({ delayMs: 200, status: 200, body: chatCompletionResponse('late') });
  try {
    await assert.rejects(
      () => sendChat({
        gatewayUrl: mock.url,
        token: 't',
        user: 'u',
        text: 'x',
        timeoutMs: 50,
      }),
      (err) => /timeout|abort/i.test(err.message || String(err)),
    );
  } finally {
    await mock.close();
  }
});

test('sendChat rejects on missing required arguments', async () => {
  await assert.rejects(() => sendChat({}), /gatewayUrl/);
  await assert.rejects(() => sendChat({ gatewayUrl: 'http://x' }), /token/);
  await assert.rejects(() => sendChat({ gatewayUrl: 'http://x', token: 't' }), /user/);
  await assert.rejects(() => sendChat({ gatewayUrl: 'http://x', token: 't', user: 'u' }), /text/);
});
