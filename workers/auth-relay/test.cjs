'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(method, url) {
  return new Request(url, { method });
}

function base64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeState(obj) {
  return base64urlEncode(JSON.stringify(obj));
}

// ── dynamic import of the ES module worker ───────────────────────────────────

let workerFetch;

async function getWorker() {
  if (workerFetch) return workerFetch;
  const mod = await import('./worker.js');
  workerFetch = mod.default.fetch.bind(mod.default);
  return workerFetch;
}

// ── tests ────────────────────────────────────────────────────────────────────

test('GET /health returns 200 { ok: true }', async () => {
  const fetch = await getWorker();
  const req = makeRequest('GET', 'https://auth.heylimbo.com/health');
  const res = await fetch(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, { ok: true });
});

test('GET /callback without state returns 400', async () => {
  const fetch = await getWorker();
  const req = makeRequest('GET', 'https://auth.heylimbo.com/callback?code=abc');
  const res = await fetch(req);
  assert.equal(res.status, 400);
});

test('GET /callback with invalid base64 state returns 400', async () => {
  const fetch = await getWorker();
  const req = makeRequest('GET', 'https://auth.heylimbo.com/callback?code=abc&state=!!!invalid!!!');
  const res = await fetch(req);
  assert.equal(res.status, 400);
});

test('GET /callback with valid state redirects correctly', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://abc123.heylimbo.com',
    nonce: 'mynonce42',
  });
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?code=mycode&state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  assert.ok(location, 'should have Location header');
  const url = new URL(location);
  assert.equal(url.origin, 'https://abc123.heylimbo.com');
  assert.equal(url.pathname, '/auth/google/callback');
  assert.equal(url.searchParams.get('code'), 'mycode');
  assert.equal(url.searchParams.get('state'), 'mynonce42');
});

test('GET /callback with state missing returnUrl returns 400', async () => {
  const fetch = await getWorker();
  const state = encodeState({ nonce: 'abc' }); // no returnUrl
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?code=x&state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 400);
});

test('GET /callback with http returnUrl returns 400', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'http://abc123.heylimbo.com',
    nonce: 'n',
  });
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?code=x&state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 400);
});

test('GET /callback with no code still redirects with state', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://xyz999.heylimbo.com',
    nonce: 'testnonce',
  });
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  const url = new URL(location);
  assert.equal(url.searchParams.get('state'), 'testnonce');
  assert.ok(!url.searchParams.has('code'));
});

// ── domain allowlist ──────────────────────────────────────────────────────────

test('GET /callback with non-heylimbo returnUrl returns 400', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://evil.example.com',
    nonce: 'n',
  });
  const req = makeRequest('GET', `https://auth.heylimbo.com/callback?code=x&state=${state}`);
  const res = await fetch(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('heylimbo.com'));
});

test('GET /callback with localhost returnUrl is allowed', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://localhost',
    nonce: 'devnonce',
  });
  const req = makeRequest('GET', `https://auth.heylimbo.com/callback?code=devcode&state=${state}`);
  const res = await fetch(req);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('Location'));
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.searchParams.get('code'), 'devcode');
});

// ── error passthrough ─────────────────────────────────────────────────────────

test('GET /callback with error param passes error through to redirect', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://abc123.heylimbo.com',
    nonce: 'mynonce',
  });
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?error=access_denied&error_description=User+denied&state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('Location'));
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('error_description'), 'User denied');
  assert.equal(url.searchParams.get('state'), 'mynonce');
  assert.ok(!url.searchParams.has('code'));
});

test('GET /callback with error but no error_description still redirects', async () => {
  const fetch = await getWorker();
  const state = encodeState({
    returnUrl: 'https://abc123.heylimbo.com',
    nonce: 'n2',
  });
  const req = makeRequest(
    'GET',
    `https://auth.heylimbo.com/callback?error=server_error&state=${state}`
  );
  const res = await fetch(req);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('Location'));
  assert.equal(url.searchParams.get('error'), 'server_error');
  assert.ok(!url.searchParams.has('error_description'));
});

// ── misc ──────────────────────────────────────────────────────────────────────

test('Unknown route returns 404', async () => {
  const fetch = await getWorker();
  const req = makeRequest('GET', 'https://auth.heylimbo.com/unknown');
  const res = await fetch(req);
  assert.equal(res.status, 404);
});
