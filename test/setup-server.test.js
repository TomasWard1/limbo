// test/setup-server.test.js — Unit tests for setup-server/server.js
'use strict';

const { describe, it, after, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

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
  it('builds correct OpenClaw auth profile schema with email', () => {
    const expiresMs = Date.now() + 3600000;
    const profile = {
      access: 'access-tok',
      refresh: 'refresh-tok',
      expires: expiresMs,
      accountId: 'acct-1',
      email: 'test@example.com',
    };
    const result = buildCodexAuthProfile(profile);
    assert.strictEqual(result.version, 1);
    const pid = 'openai-codex:test@example.com';
    assert.ok(result.profiles[pid], 'profile entry exists');
    assert.strictEqual(result.profiles[pid].type, 'oauth');
    assert.strictEqual(result.profiles[pid].provider, 'openai-codex');
    assert.strictEqual(result.profiles[pid].access, 'access-tok');
    assert.strictEqual(result.profiles[pid].refresh, 'refresh-tok');
    assert.strictEqual(result.profiles[pid].expires, expiresMs);
    assert.strictEqual(result.profiles[pid].email, 'test@example.com');
    assert.strictEqual(result.profiles[pid].accountId, 'acct-1');
    // Must NOT have ZeroClaw fields
    assert.strictEqual(result.schema_version, undefined);
    assert.strictEqual(result.active_profiles, undefined);
  });

  it('builds correct structure without email (default profile)', () => {
    const profile = {
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 1000,
    };
    const result = buildCodexAuthProfile(profile);
    const pid = 'openai-codex:default';
    assert.ok(result.profiles[pid], 'profile entry exists');
    assert.strictEqual(result.profiles[pid].email, '');
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

// ─── C. Wizard → Entrypoint integration tests ─────────────────────────────
// These tests re-require the server module with temp directories to verify
// that the wizard writes files in the exact paths the entrypoint reads from.

/**
 * Load a fresh server module with custom DATA_DIR and OPENCLAW_STATE_DIR.
 * Clears require cache so module-level constants bind to the new env vars.
 */
function loadServerWithDirs(dataDir, openclawStateDir) {
  const modPath = require.resolve('../setup-server/server.js');
  delete require.cache[modPath];
  const prevData = process.env.LIMBO_DATA_DIR;
  const prevState = process.env.OPENCLAW_STATE_DIR;
  process.env.LIMBO_DATA_DIR = dataDir;
  process.env.OPENCLAW_STATE_DIR = openclawStateDir;
  const mod = require(modPath);
  // Restore env so we don't leak into other tests
  if (prevData === undefined) delete process.env.LIMBO_DATA_DIR;
  else process.env.LIMBO_DATA_DIR = prevData;
  if (prevState === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = prevState;
  return mod;
}

/**
 * HTTP request helper for integration test servers.
 */
function requestTo(srv, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const addr = srv.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
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

describe('Wizard → Entrypoint integration', () => {
  let tmpDir, dataDir, openclawState, mod, srv;
  const originalExit = process.exit;

  beforeEach(() => {
    // Stub process.exit — handleConfigure calls setTimeout(process.exit, 10000)
    process.exit = () => {};
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-test-'));
    dataDir = path.join(tmpDir, 'data');
    openclawState = path.join(tmpDir, 'openclaw-state');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(openclawState, { recursive: true });
    mod = loadServerWithDirs(dataDir, openclawState);
    srv = http.createServer(mod.handleRequest);
  });

  afterEach(() => {
    process.exit = originalExit;
    return new Promise((resolve) => {
      srv.close(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      });
    });
  });

  function startServer() {
    return new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', resolve);
    });
  }

  // ── 1. Path consistency: wizard writes → entrypoint reads ────────────────

  it('handleConfigure writes .env to DATA_DIR/config/.env', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json.success);

    const envPath = path.join(dataDir, 'config', '.env');
    assert.ok(fs.existsSync(envPath), '.env file must exist at DATA_DIR/config/.env');
  });

  it('handleConfigure writes all tokens into .env', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
      telegram: { enabled: true, botToken: 'bot-token-123' },
      features: {
        voice: { enabled: true, apiKey: 'groq-key-abc' },
        webSearch: { enabled: true, apiKey: 'brave-key-xyz' },
      },
    });
    assert.strictEqual(res.statusCode, 200);

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes('LLM_API_KEY=sk-ant-test-key-1234567890abcdef'), 'LLM_API_KEY in .env');
    assert.ok(envContent.includes('TELEGRAM_BOT_TOKEN=bot-token-123'), 'TELEGRAM_BOT_TOKEN in .env');
    assert.ok(envContent.includes('GROQ_API_KEY=groq-key-abc'), 'GROQ_API_KEY in .env');
    assert.ok(envContent.includes('BRAVE_API_KEY=brave-key-xyz'), 'BRAVE_API_KEY in .env');
    assert.ok(envContent.match(/GATEWAY_TOKEN=\S+/), 'GATEWAY_TOKEN present');

    // Legacy secrets/ directory must NOT be created
    assert.ok(
      !fs.existsSync(path.join(openclawState, 'secrets')),
      'openclaw-state/secrets must not be created'
    );
  });

  it('token paths match what entrypoint .env sourcing expects', async () => {
    // The entrypoint now sources /data/config/.env; all tokens must be there.
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'openai',
      apiKey: 'sk-test-openai-key-1234567890abcdef',
    });

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes('LLM_API_KEY=sk-test-openai-key-1234567890abcdef'));
  });

  // ── 2. .env format: shell-sourceable ─────────────────────────────────────

  it('.env has quoted values (KEY="value" format)', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
      model: 'claude-opus-4-6',
      language: 'es',
      telegram: { enabled: true, botToken: 'tok' },
      features: {
        voice: { enabled: true, apiKey: 'gk' },
        webSearch: { enabled: true, apiKey: 'bk' },
      },
    });

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    const lines = envContent.trim().split('\n');

    for (const line of lines) {
      // Post-consolidation, both cli.js and setup-server emit raw KEY=value
      // lines (no surrounding quotes). Shell-sourceable via `set -a; . file`
      // as long as values contain no whitespace or shell metacharacters —
      // none of our tokens do.
      assert.match(line, /^[A-Z_]+=\S*$/, `Line not in KEY=value format: ${line}`);
    }
  });

  it('.env contains all vars the entrypoint expects', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
      telegram: { enabled: true, botToken: 'tok' },
      features: {
        voice: { enabled: true, apiKey: 'gk' },
        webSearch: { enabled: true, apiKey: 'bk' },
      },
    });

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');

    // The entrypoint sources .env and reads these specific vars
    const requiredVars = [
      'MODEL_PROVIDER',
      'MODEL_NAME',
      'TELEGRAM_ENABLED',
      'VOICE_ENABLED',
      'WEB_SEARCH_ENABLED',
      'LIMBO_PORT',
      'AUTH_MODE',
      'CLI_LANGUAGE',
    ];

    for (const varName of requiredVars) {
      assert.ok(envContent.includes(`${varName}=`), `.env must contain ${varName}`);
    }
  });

  it('.env is valid for shell sourcing (set -a; . file; set +a)', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'openrouter',
      apiKey: 'sk-or-test-key-1234567890abcdef',
      model: 'anthropic/claude-opus-4-6',
      language: 'en',
    });

    const envPath = path.join(dataDir, 'config', '.env');
    // Actually source it with sh and read vars back
    const result = execSync(
      `sh -c 'set -a; . "${envPath}"; set +a; echo "$MODEL_PROVIDER"'`,
      { encoding: 'utf8' },
    ).trim();
    assert.strictEqual(result, 'openrouter', 'MODEL_PROVIDER should be readable after sourcing');

    const modelResult = execSync(
      `sh -c 'set -a; . "${envPath}"; set +a; echo "$MODEL_NAME"'`,
      { encoding: 'utf8' },
    ).trim();
    assert.strictEqual(modelResult, 'anthropic/claude-opus-4-6',
      'MODEL_NAME with slash should survive shell sourcing');
  });

  it('.env values with provider defaults are correct', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes(`MODEL_NAME=${MODEL_CATALOG.anthropic.defaultModel}`),
      'should use provider default model');
    assert.ok(envContent.includes('TELEGRAM_ENABLED=false'), 'telegram defaults to false');
    assert.ok(envContent.includes('VOICE_ENABLED=false'), 'voice defaults to false');
    assert.ok(envContent.includes('WEB_SEARCH_ENABLED=false'), 'web search defaults to false');
  });

  // ── 3. File permissions ─────────────────────────────────────────────────
  // With the secrets-in-.env consolidation, the container (uid 999) must be
  // able to write inside the host-owned config dir. The mode is intentionally
  // permissive because ~/.limbo/ lives under the user's home and is not
  // exposed to other users of the host.

  it('.env file has mode 0666 (writable by container uid)', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });

    const envPath = path.join(dataDir, 'config', '.env');
    const stat = fs.statSync(envPath);
    const perms = stat.mode & 0o777;
    assert.strictEqual(perms, 0o666, `.env perms should be 0666, got ${perms.toString(8)}`);
  });

  it('config directory has mode 0777 (writable by container uid)', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });

    const configDir = path.join(dataDir, 'config');
    const stat = fs.statSync(configDir);
    const perms = stat.mode & 0o777;
    assert.strictEqual(perms, 0o777, `config dir perms should be 0777, got ${perms.toString(8)}`);
  });

  // ── 4. Auth profile consistency ──────────────────────────────────────────

  it('writeAuthProfiles writes to OPENCLAW_STATE_DIR (not ZEROCLAW)', () => {
    const store = mod.buildCodexAuthProfile({
      access: 'access-tok',
      refresh: 'refresh-tok',
      expires: Date.now() + 3600000,
      email: 'test@example.com',
    });
    mod._internals.writeAuthProfiles(store);

    const authPath = path.join(openclawState, 'agents', 'main', 'agent', 'auth-profiles.json');
    assert.ok(fs.existsSync(authPath), 'auth-profiles.json must be at agents/main/agent/');

    const written = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(written.version, 1);
    assert.ok(written.profiles['openai-codex:test@example.com'], 'profile entry exists');
    assert.strictEqual(written.profiles['openai-codex:test@example.com'].type, 'oauth');
  });

  it('auth-profiles.json has mode 0600', () => {
    const store = mod.buildCodexAuthProfile({
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 1000,
      email: 'x@y.com',
    });
    mod._internals.writeAuthProfiles(store);

    const authPath = path.join(openclawState, 'agents', 'main', 'agent', 'auth-profiles.json');
    const stat = fs.statSync(authPath);
    const perms = stat.mode & 0o777;
    assert.strictEqual(perms, 0o600, `auth-profiles.json perms should be 0600, got ${perms.toString(8)}`);
  });

  it('buildCodexAuthProfile has correct OpenClaw schema fields', () => {
    const expiresMs = Date.now() + 3600000;
    const profile = mod.buildCodexAuthProfile({
      access: 'acc',
      refresh: 'ref',
      expires: expiresMs,
      accountId: 'acct-1',
      email: 'user@domain.com',
    });

    assert.strictEqual(profile.version, 1);
    const pid = 'openai-codex:user@domain.com';
    const p = profile.profiles[pid];
    assert.ok(p, 'profile entry exists');
    assert.strictEqual(p.type, 'oauth');
    assert.strictEqual(p.provider, 'openai-codex');
    assert.strictEqual(p.access, 'acc');
    assert.strictEqual(p.refresh, 'ref');
    assert.strictEqual(p.expires, expiresMs);
    assert.strictEqual(p.email, 'user@domain.com');
    assert.strictEqual(p.accountId, 'acct-1');
  });

  // ── 5. Edge cases ────────────────────────────────────────────────────────

  it('configure with only required fields (no optional features)', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-minimal-key-12345678',
    });
    assert.strictEqual(res.statusCode, 200);

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes('LLM_API_KEY=sk-ant-test-minimal-key-12345678'), 'llm key in env');
    assert.ok(envContent.match(/GATEWAY_TOKEN=\S+/), 'gateway_token auto-generated');
    // Optional tokens should be empty (or absent)
    assert.ok(
      /TELEGRAM_BOT_TOKEN=\n/.test(envContent) ||
        /TELEGRAM_BOT_TOKEN=$/m.test(envContent) ||
        !envContent.includes('TELEGRAM_BOT_TOKEN='),
      'no telegram token set'
    );
    assert.ok(envContent.includes('TELEGRAM_ENABLED=false'));
    assert.ok(envContent.includes('VOICE_ENABLED=false'));
    assert.ok(envContent.includes('WEB_SEARCH_ENABLED=false'));
  });

  it('configure with ALL features enabled', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'openrouter',
      apiKey: 'sk-or-all-features-key-1234567890',
      model: 'google/gemini-2.5-pro',
      language: 'es',
      telegram: { enabled: true, botToken: 'bot-telegram-token' },
      features: {
        voice: { enabled: true, apiKey: 'groq-voice-key' },
        webSearch: { enabled: true, apiKey: 'brave-search-key' },
      },
    });
    assert.strictEqual(res.statusCode, 200);

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');

    // All tokens present with correct content in .env
    assert.ok(envContent.includes('LLM_API_KEY=sk-or-all-features-key-1234567890'));
    assert.ok(envContent.includes('TELEGRAM_BOT_TOKEN=bot-telegram-token'));
    assert.ok(envContent.includes('GROQ_API_KEY=groq-voice-key'));
    assert.ok(envContent.includes('BRAVE_API_KEY=brave-search-key'));

    // All features enabled
    assert.ok(envContent.includes('TELEGRAM_ENABLED=true'));
    assert.ok(envContent.includes('VOICE_ENABLED=true'));
    assert.ok(envContent.includes('WEB_SEARCH_ENABLED=true'));
    assert.ok(envContent.includes('MODEL_PROVIDER=openrouter'));
    assert.ok(envContent.includes('MODEL_NAME=google/gemini-2.5-pro'));
    assert.ok(envContent.includes('CLI_LANGUAGE=es'));
  });

  it('special characters in API keys survive round-trip through .env', async () => {
    await startServer();
    // Raw KEY=value encoding only supports values without whitespace or
    // shell-interpretable characters (quotes, $, backticks). API key
    // charsets never contain whitespace, and real provider keys never
    // contain shell metachars, so raw encoding is safe in practice.
    const trickyKey = 'sk-ant-key-with/slashes+base64==abcdef';
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: trickyKey,
    });
    assert.strictEqual(res.statusCode, 200);

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes(`LLM_API_KEY=${trickyKey}`), 'key stored verbatim in .env');
  });

  it('gateway token is auto-generated on first run', async () => {
    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-gateway-gen-1234567890',
    });

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    const m = envContent.match(/GATEWAY_TOKEN=(\S+)/);
    assert.ok(m, 'GATEWAY_TOKEN must be present in .env');
    assert.ok(m[1].length >= 20, 'token should be sufficiently long (24 bytes base64url)');
  });

  it('gateway token is preserved on subsequent runs', async () => {
    // Pre-populate the .env with a known gateway token.
    const configDir = path.join(dataDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const existingToken = 'pre-existing-gateway-token-abc123';
    fs.writeFileSync(path.join(configDir, '.env'), `GATEWAY_TOKEN=${existingToken}\n`);

    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-preserve-1234567890ab',
    });

    const envContent = fs.readFileSync(path.join(configDir, '.env'), 'utf8');
    assert.ok(envContent.includes(`GATEWAY_TOKEN=${existingToken}`), 'existing gateway token must be preserved');
  });

  it('TELEGRAM_CHAT_ID written by step-6 pairing is preserved across configure', async () => {
    // Regression guard for C1: handleConfigure used to rebuild envVars from
    // scratch in the full-setup branch, clobbering keys written by earlier
    // wizard steps such as TELEGRAM_CHAT_ID (set by handleTelegramPair).
    const configDir = path.join(dataDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const existingChatId = '999888';
    fs.writeFileSync(
      path.join(configDir, '.env'),
      `TELEGRAM_CHAT_ID=${existingChatId}\n`,
    );

    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-chatid-preserve-12345',
      telegram: { enabled: true, botToken: 'bot-token-xyz' },
    });
    assert.strictEqual(res.statusCode, 200);

    const envContent = fs.readFileSync(path.join(configDir, '.env'), 'utf8');
    assert.ok(
      envContent.includes(`TELEGRAM_CHAT_ID=${existingChatId}`),
      'TELEGRAM_CHAT_ID from step-6 pairing must survive handleConfigure',
    );
    // And the wizard-supplied keys still take effect.
    assert.ok(envContent.includes('TELEGRAM_BOT_TOKEN=bot-token-xyz'));
    assert.ok(envContent.includes('TELEGRAM_ENABLED=true'));
  });

  it('configure rejects missing provider', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.json.error.includes('provider'));
  });

  it('configure rejects unknown provider', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'unknown-provider',
      apiKey: 'sk-ant-test-key-1234567890abcdef',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.json.error.includes('Unknown provider'));
  });

  it('configure rejects wrong key prefix for provider', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-openai-key-not-anthropic-12345',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.json.error.includes('Invalid API key format'));
  });

  it('configure with subscription authMode skips apiKey requirement', async () => {
    await startServer();
    const res = await requestTo(srv, 'POST', '/api/configure', {
      provider: 'openai',
      authMode: 'subscription',
    });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json.success);

    const envContent = fs.readFileSync(path.join(dataDir, 'config', '.env'), 'utf8');
    assert.ok(envContent.includes('AUTH_MODE=subscription'));
  });

  it('setup_token file is removed after configure', async () => {
    const configDir = path.join(dataDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'setup_token'), 'test-token');

    await startServer();
    await requestTo(srv, 'POST', '/api/configure', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-cleanup-key-12345678',
    });

    assert.ok(!fs.existsSync(path.join(configDir, 'setup_token')),
      'setup_token should be removed after configure');
  });
});
