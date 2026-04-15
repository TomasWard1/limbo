// test/cloud-oauth.test.js — Tests for OAuth relay mode (LIMBO_PUBLIC_URL)
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Load a fresh server module with specific env vars set.
 * Clears require cache so module-level constants (PUBLIC_URL, etc.) bind to new values.
 */
function loadServerWithEnv(envOverrides) {
  const modPath = require.resolve('../setup-server/server.js');
  delete require.cache[modPath];

  const saved = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }

  const mod = require(modPath);

  // Restore env immediately so other tests are unaffected
  for (const [k, orig] of Object.entries(saved)) {
    if (orig === undefined) delete process.env[k];
    else process.env[k] = orig;
  }

  return mod;
}

function requestTo(srv, method, urlPath) {
  return new Promise((resolve, reject) => {
    const addr = srv.address();
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path: urlPath, method },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ statusCode: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ─── Relay mode off (no PUBLIC_URL) ─────────────────────────────────────────

describe('Google OAuth start — local mode (no PUBLIC_URL)', () => {
  let srv;

  before(() => new Promise((resolve) => {
    // Load with LIMBO_DATA_DIR set to a temp dir so readEnvFile doesn't fail
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-oauth-test-'));
    const mod = loadServerWithEnv({
      LIMBO_DATA_DIR: tmp,
      LIMBO_PUBLIC_URL: '',
    });
    srv = http.createServer(mod.handleRequest);
    srv.listen(0, '127.0.0.1', resolve);
  }));

  after(() => new Promise((resolve) => srv.close(resolve)));

  it('redirect_uri uses localhost when PUBLIC_URL is empty', async () => {
    const res = await requestTo(srv, 'GET', '/api/auth/google/start');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json && res.json.authUrl, 'should return authUrl');
    const url = new URL(res.json.authUrl);
    const redirectUri = url.searchParams.get('redirect_uri');
    assert.ok(
      redirectUri.startsWith('http://localhost:'),
      `expected localhost redirect_uri, got: ${redirectUri}`,
    );
    assert.ok(redirectUri.endsWith('/auth/google/callback'), `expected /auth/google/callback suffix`);
  });

  it('state is a plain hex nonce (not base64url JSON) when PUBLIC_URL is empty', async () => {
    const res = await requestTo(srv, 'GET', '/api/auth/google/start');
    assert.strictEqual(res.statusCode, 200);
    const url = new URL(res.json.authUrl);
    const state = url.searchParams.get('state');
    // Plain hex nonce: 32 hex chars
    assert.match(state, /^[0-9a-f]{32}$/, `expected hex nonce, got: ${state}`);
  });
});

// ─── Relay mode on (PUBLIC_URL set) ─────────────────────────────────────────

describe('Google OAuth start — relay mode (LIMBO_PUBLIC_URL set)', () => {
  let srv;
  const PUBLIC_URL = 'https://abc123.heylimbo.com';
  const RELAY_URL = 'https://auth.heylimbo.com';

  before(() => new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-oauth-relay-test-'));
    const mod = loadServerWithEnv({
      LIMBO_DATA_DIR: tmp,
      LIMBO_PUBLIC_URL: PUBLIC_URL,
      LIMBO_OAUTH_RELAY_URL: RELAY_URL,
    });
    srv = http.createServer(mod.handleRequest);
    srv.listen(0, '127.0.0.1', resolve);
  }));

  after(() => new Promise((resolve) => srv.close(resolve)));

  it('redirect_uri points to the relay Worker when PUBLIC_URL is set', async () => {
    const res = await requestTo(srv, 'GET', '/api/auth/google/start');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json && res.json.authUrl, 'should return authUrl');
    const url = new URL(res.json.authUrl);
    const redirectUri = url.searchParams.get('redirect_uri');
    assert.strictEqual(
      redirectUri,
      `${RELAY_URL}/callback`,
      `expected relay redirect_uri, got: ${redirectUri}`,
    );
  });

  it('state is base64url-encoded JSON with returnUrl and nonce', async () => {
    const res = await requestTo(srv, 'GET', '/api/auth/google/start');
    assert.strictEqual(res.statusCode, 200);
    const url = new URL(res.json.authUrl);
    const state = url.searchParams.get('state');

    // Must be valid base64url (no +, /, = padding)
    assert.doesNotMatch(state, /[+/=]/, `state should be base64url, got: ${state}`);

    // Decode and verify structure
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    assert.strictEqual(decoded.returnUrl, PUBLIC_URL, 'returnUrl should match PUBLIC_URL');
    assert.match(decoded.nonce, /^[0-9a-f]{32}$/, `nonce should be hex, got: ${decoded.nonce}`);
  });

  it('uses default relay URL when LIMBO_OAUTH_RELAY_URL is not set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-oauth-default-relay-'));
    const mod = loadServerWithEnv({
      LIMBO_DATA_DIR: tmp,
      LIMBO_PUBLIC_URL: PUBLIC_URL,
      // LIMBO_OAUTH_RELAY_URL intentionally not set
    });
    const srv2 = http.createServer(mod.handleRequest);
    await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));
    try {
      const res = await requestTo(srv2, 'GET', '/api/auth/google/start');
      assert.strictEqual(res.statusCode, 200);
      const url = new URL(res.json.authUrl);
      const redirectUri = url.searchParams.get('redirect_uri');
      assert.strictEqual(
        redirectUri,
        'https://auth.heylimbo.com/callback',
        `expected default relay URL, got: ${redirectUri}`,
      );
    } finally {
      await new Promise((resolve) => srv2.close(resolve));
    }
  });
});

// ─── _internals exports ──────────────────────────────────────────────────────

describe('_internals PUBLIC_URL / OAUTH_RELAY_URL exports', () => {
  it('PUBLIC_URL defaults to empty string when env is not set', () => {
    const mod = loadServerWithEnv({ LIMBO_PUBLIC_URL: '' });
    assert.strictEqual(mod._internals.PUBLIC_URL, '');
  });

  it('PUBLIC_URL reflects LIMBO_PUBLIC_URL env var', () => {
    const mod = loadServerWithEnv({ LIMBO_PUBLIC_URL: 'https://example.heylimbo.com' });
    assert.strictEqual(mod._internals.PUBLIC_URL, 'https://example.heylimbo.com');
  });

  it('OAUTH_RELAY_URL defaults to https://auth.heylimbo.com', () => {
    const mod = loadServerWithEnv({ LIMBO_OAUTH_RELAY_URL: '' });
    assert.strictEqual(mod._internals.OAUTH_RELAY_URL, 'https://auth.heylimbo.com');
  });

  it('OAUTH_RELAY_URL reflects LIMBO_OAUTH_RELAY_URL env var', () => {
    const mod = loadServerWithEnv({ LIMBO_OAUTH_RELAY_URL: 'https://custom-relay.example.com' });
    assert.strictEqual(mod._internals.OAUTH_RELAY_URL, 'https://custom-relay.example.com');
  });
});
