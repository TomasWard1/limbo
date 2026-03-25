// test/setup-server.test.js — Unit tests for setup-server/server.js
'use strict';

const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

const {
  MODEL_CATALOG,
  KEY_PREFIXES,
  MIME_TYPES,
  parseJSON,
  generatePKCE,
  buildOAuthUrl,
  decodeJwtPayload,
  buildCodexAuthProfile,
  handleRequest,
  _internals: { OPENAI_OAUTH },
} = require('../setup-server/server.js');

// ─── Helper: make HTTP request against test server ──────────────────────────

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {},
    };

    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, raw, json });
      });
    });

    req.on('error', reject);

    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

// ─── A. Pure function tests ─────────────────────────────────────────────────

describe('parseJSON', () => {
  it('parses valid JSON', () => {
    assert.deepStrictEqual(parseJSON('{"a":1}'), { a: 1 });
  });

  it('returns null for invalid JSON', () => {
    assert.strictEqual(parseJSON('not json'), null);
  });

  it('returns null for empty string', () => {
    assert.strictEqual(parseJSON(''), null);
  });
});

describe('KEY_PREFIXES', () => {
  it('has correct prefix for openai', () => {
    assert.strictEqual(KEY_PREFIXES.openai, 'sk-');
  });

  it('has correct prefix for anthropic', () => {
    assert.strictEqual(KEY_PREFIXES.anthropic, 'sk-ant-');
  });

  it('has correct prefix for openrouter', () => {
    assert.strictEqual(KEY_PREFIXES.openrouter, 'sk-or-');
  });
});

describe('MODEL_CATALOG', () => {
  for (const provider of ['anthropic', 'openai', 'openrouter']) {
    it(`${provider} has defaultModel and models array`, () => {
      const entry = MODEL_CATALOG[provider];
      assert.ok(entry, `missing provider ${provider}`);
      assert.ok(typeof entry.defaultModel === 'string', 'defaultModel is string');
      assert.ok(Array.isArray(entry.models), 'models is array');
      assert.ok(entry.models.length > 0, 'models is non-empty');
    });

    it(`${provider} models have id and name`, () => {
      for (const m of MODEL_CATALOG[provider].models) {
        assert.ok(typeof m.id === 'string' && m.id.length > 0, `model missing id`);
        assert.ok(typeof m.name === 'string' && m.name.length > 0, `model missing name`);
      }
    });
  }
});

describe('generatePKCE', () => {
  it('returns verifier and challenge strings', () => {
    const pkce = generatePKCE();
    assert.ok(typeof pkce.verifier === 'string' && pkce.verifier.length > 0);
    assert.ok(typeof pkce.challenge === 'string' && pkce.challenge.length > 0);
  });

  it('challenge is sha256 of verifier (base64url)', () => {
    const pkce = generatePKCE();
    const expected = crypto.createHash('sha256').update(pkce.verifier).digest('base64url');
    assert.strictEqual(pkce.challenge, expected);
  });
});

describe('buildOAuthUrl', () => {
  it('includes required OAuth params', () => {
    const pkce = generatePKCE();
    const state = 'test-state-123';
    const redirectUri = 'http://localhost:1455/auth/callback';
    const url = buildOAuthUrl(pkce, state, redirectUri);

    assert.ok(url.includes('response_type=code'), 'missing response_type');
    assert.ok(url.includes(`client_id=${OPENAI_OAUTH.clientId}`), 'missing client_id');
    assert.ok(url.includes(`code_challenge=${pkce.challenge}`), 'missing code_challenge');
    assert.ok(url.includes(`state=${state}`), 'missing state');
    assert.ok(url.includes('code_challenge_method=S256'), 'missing code_challenge_method');
    assert.ok(url.startsWith(OPENAI_OAUTH.authorizeUrl), 'wrong base URL');
  });
});

describe('decodeJwtPayload', () => {
  it('decodes a valid 3-part JWT', () => {
    const payload = { sub: 'user-123', email: 'test@example.com' };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `header.${b64}.signature`;
    const decoded = decodeJwtPayload(token);
    assert.deepStrictEqual(decoded, payload);
  });

  it('returns empty object for 1-part token', () => {
    assert.deepStrictEqual(decodeJwtPayload('single-part'), {});
  });

  it('extracts nested claims', () => {
    const payload = {
      sub: 'user-1',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-abc',
      },
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `h.${b64}.s`;
    const decoded = decodeJwtPayload(token);
    assert.strictEqual(decoded['https://api.openai.com/auth'].chatgpt_account_id, 'acct-abc');
  });
});

describe('buildCodexAuthProfile', () => {
  it('builds correct structure with email', () => {
    const profile = {
      access: 'access-tok',
      refresh: 'refresh-tok',
      expires: Date.now() + 3600000,
      accountId: 'acct-1',
      email: 'test@example.com',
    };
    const result = buildCodexAuthProfile(profile);
    assert.strictEqual(result.version, 1);
    const pid = 'openai-codex:test@example.com';
    assert.ok(result.profiles[pid], 'profile entry exists');
    assert.strictEqual(result.profiles[pid].provider, 'openai-codex');
    assert.strictEqual(result.profiles[pid].type, 'oauth');
    assert.strictEqual(result.profiles[pid].access, 'access-tok');
    assert.strictEqual(result.profiles[pid].refresh, 'refresh-tok');
  });

  it('builds correct structure without email (accountId empty)', () => {
    const profile = {
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 1000,
    };
    const result = buildCodexAuthProfile(profile);
    const pid = 'openai-codex:default';
    assert.strictEqual(result.profiles[pid].accountId, '');
  });
});

// ─── B. HTTP handler tests ──────────────────────────────────────────────────

describe('HTTP handler', () => {
  let server;

  before(() => {
    return new Promise((resolve) => {
      server = http.createServer(handleRequest);
      server.listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  // Note: SETUP_TOKEN is null when imported (not running as main module).
  // checkToken compares searchParams.get('token') === null, so requests
  // WITHOUT a token param pass auth (null === null). Requests with a WRONG
  // token correctly fail (e.g. 'wrong' !== null).

  it('GET /api/models without token passes (SETUP_TOKEN is null)', async () => {
    // null === null → auth passes, returns the catalog
    const res = await request(server, 'GET', '/api/models');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json && res.json.anthropic, 'should return model catalog');
  });

  it('GET /api/models with wrong token returns 403', async () => {
    const res = await request(server, 'GET', '/api/models?token=wrong');
    assert.strictEqual(res.statusCode, 403);
  });

  it('GET /api/models with provider filter returns single provider', async () => {
    const res = await request(server, 'GET', '/api/models?provider=openai');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json && res.json.defaultModel, 'should return provider entry');
    assert.ok(Array.isArray(res.json.models), 'should have models array');
  });

  it('path traversal is neutralised by Node URL parsing', async () => {
    // Node's HTTP parser normalises /../../../etc/passwd → /etc/passwd
    // serveStatic resolves it inside PUBLIC_DIR and returns 404 (not found)
    const res = await request(server, 'GET', '/../../../etc/passwd');
    assert.ok([403, 404].includes(res.statusCode), `expected 403 or 404, got ${res.statusCode}`);
  });

  it('GET /auth/callback without code handles missing PKCE session', async () => {
    const res = await request(server, 'GET', '/auth/callback?code=test&state=none');
    // Should return 400 with error page (invalid session) — not crash
    assert.ok(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    assert.ok(res.raw.includes('Invalid or expired session'), 'should mention invalid session');
  });

  it('POST /api/validate-key without body returns 400', async () => {
    // Auth passes (null token), but missing body fields → 400
    const res = await request(server, 'POST', '/api/validate-key', {});
    assert.strictEqual(res.statusCode, 400);
  });

  it('unsupported method returns 405', async () => {
    // Auth passes (null token), but DELETE is not handled → 405
    const res = await request(server, 'DELETE', '/api/models');
    assert.strictEqual(res.statusCode, 405);
    assert.ok(res.json && res.json.error.includes('Method not allowed'));
  });
});
