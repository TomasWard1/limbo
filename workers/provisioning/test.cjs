'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Provide Web Crypto if needed (Node 18 guard)
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = require('node:crypto');
  globalThis.crypto = webcrypto;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(method, url, { headers = {}, body } = {}) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const baseEnv = {
  CF_ZONE_ID: 'zone123',
  CF_API_TOKEN: 'token123',
  PROVISION_SECRET: 'supersecret',
};

function authHeader() {
  return { Authorization: 'Bearer supersecret' };
}

// ── dynamic import of ES module worker ───────────────────────────────────────

let workerFetch;
async function getWorker() {
  if (workerFetch) return workerFetch;
  const mod = await import('./worker.js');
  workerFetch = mod.default.fetch.bind(mod.default);
  return workerFetch;
}

// ── health ────────────────────────────────────────────────────────────────────

test('GET /health returns 200 { ok: true }', async () => {
  const fetch = await getWorker();
  const res = await fetch(makeRequest('GET', 'https://api.heylimbo.com/health'), baseEnv);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('GET /health requires no auth', async () => {
  const fetch = await getWorker();
  const res = await fetch(makeRequest('GET', 'https://api.heylimbo.com/health'), baseEnv);
  assert.equal(res.status, 200);
});

// ── auth ─────────────────────────────────────────────────────────────────────

test('POST /provision without auth returns 401', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('POST', 'https://api.heylimbo.com/provision', { body: { ip: '8.8.8.8' } }),
    baseEnv
  );
  assert.equal(res.status, 401);
});

test('POST /provision with wrong token returns 401', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('POST', 'https://api.heylimbo.com/provision', {
      headers: { Authorization: 'Bearer wrongtoken' },
      body: { ip: '8.8.8.8' },
    }),
    baseEnv
  );
  assert.equal(res.status, 401);
});

test('DELETE /provision/:id without auth returns 401', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('DELETE', 'https://api.heylimbo.com/provision/abc123'),
    baseEnv
  );
  assert.equal(res.status, 401);
});

// ── IP validation ─────────────────────────────────────────────────────────────

test('POST /provision with missing ip returns 400', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('POST', 'https://api.heylimbo.com/provision', {
      headers: authHeader(),
      body: {},
    }),
    baseEnv
  );
  assert.equal(res.status, 400);
});

test('POST /provision with invalid IP format returns 400', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('POST', 'https://api.heylimbo.com/provision', {
      headers: authHeader(),
      body: { ip: 'not-an-ip' },
    }),
    baseEnv
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('Invalid IP'));
});

test('POST /provision with octet out of range returns 400', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('POST', 'https://api.heylimbo.com/provision', {
      headers: authHeader(),
      body: { ip: '256.1.1.1' },
    }),
    baseEnv
  );
  assert.equal(res.status, 400);
});

const privateIPs = [
  '10.0.0.1',
  '10.255.255.255',
  '127.0.0.1',
  '127.1.2.3',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.0.1',
  '192.168.1.100',
  '169.254.0.1',
  '0.0.0.1',
];

for (const ip of privateIPs) {
  test(`POST /provision with private IP ${ip} returns 400`, async () => {
    const fetch = await getWorker();
    const res = await fetch(
      makeRequest('POST', 'https://api.heylimbo.com/provision', {
        headers: authHeader(),
        body: { ip },
      }),
      baseEnv
    );
    assert.equal(res.status, 400);
  });
}

test('POST /provision with valid public IP calls CF API and returns id+url', async () => {
  const fetch = await getWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(url.includes('/dns_records'));
    const reqBody = JSON.parse(opts.body);
    assert.equal(reqBody.type, 'A');
    assert.equal(reqBody.content, '8.8.8.8');
    assert.equal(reqBody.proxied, true);
    return new Response(JSON.stringify({ success: true, result: { id: 'rec123' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const res = await fetch(
      makeRequest('POST', 'https://api.heylimbo.com/provision', {
        headers: authHeader(),
        body: { ip: '8.8.8.8' },
      }),
      baseEnv
    );
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id, 'should have id');
    assert.equal(data.id.length, 6);
    assert.ok(data.url.startsWith('https://'));
    assert.ok(data.url.endsWith('.heylimbo.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── DELETE ────────────────────────────────────────────────────────────────────

test('DELETE /provision/:id returns 404 when record not found', async () => {
  const fetch = await getWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, result: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    const res = await fetch(
      makeRequest('DELETE', 'https://api.heylimbo.com/provision/abc123', {
        headers: authHeader(),
      }),
      baseEnv
    );
    assert.equal(res.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DELETE /provision/:id returns 204 on success', async () => {
  const fetch = await getWorker();
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (url, opts) => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({ success: true, result: [{ id: 'rec456' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    assert.ok(url.includes('/rec456'));
    assert.equal(opts.method, 'DELETE');
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const res = await fetch(
      makeRequest('DELETE', 'https://api.heylimbo.com/provision/abc123', {
        headers: authHeader(),
      }),
      baseEnv
    );
    assert.equal(res.status, 204);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── misc ──────────────────────────────────────────────────────────────────────

test('Unknown route returns 404', async () => {
  const fetch = await getWorker();
  const res = await fetch(
    makeRequest('GET', 'https://api.heylimbo.com/unknown', { headers: authHeader() }),
    baseEnv
  );
  assert.equal(res.status, 404);
});
