// test/cli-auth.test.js
// Unit tests for CLI install-phase pure functions exported from cli.js.
// Run with: node --test test/cli-auth.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  MODEL_CATALOG,
  normalizeConfig,
  deriveProviderFamily,
  getModelCatalog,
  parseCallbackInput,
  decodeJwtPayload,
  parseClaudeSetupToken,
  buildCodexAuthProfile,
  buildAnthropicAuthProfile,
  generatePKCE,
  buildOAuthUrl,
} = require('../cli.js');

// ─── deriveProviderFamily ─────────────────────────────────────────────────────

test('deriveProviderFamily: null/undefined returns anthropic', () => {
  assert.equal(deriveProviderFamily(null), 'anthropic');
  assert.equal(deriveProviderFamily(undefined), 'anthropic');
});

test('deriveProviderFamily: openai-codex returns openai', () => {
  assert.equal(deriveProviderFamily('openai-codex'), 'openai');
});

test('deriveProviderFamily: openai returns openai', () => {
  assert.equal(deriveProviderFamily('openai'), 'openai');
});

test('deriveProviderFamily: openrouter returns openrouter', () => {
  assert.equal(deriveProviderFamily('openrouter'), 'openrouter');
});

test('deriveProviderFamily: unknown provider returns anthropic', () => {
  assert.equal(deriveProviderFamily('mistral'), 'anthropic');
  assert.equal(deriveProviderFamily('google'), 'anthropic');
});

// ─── getModelCatalog ──────────────────────────────────────────────────────────

test('getModelCatalog: returns correct catalog for openai:subscription', () => {
  const catalog = getModelCatalog('openai', 'subscription');
  assert.ok(catalog);
  assert.equal(catalog.provider, 'openai-codex');
});

test('getModelCatalog: returns correct catalog for openai:api-key', () => {
  const catalog = getModelCatalog('openai', 'api-key');
  assert.ok(catalog);
  assert.equal(catalog.provider, 'openai');
});

test('getModelCatalog: returns correct catalog for anthropic:subscription', () => {
  const catalog = getModelCatalog('anthropic', 'subscription');
  assert.ok(catalog);
  assert.equal(catalog.provider, 'anthropic');
});

test('getModelCatalog: returns correct catalog for anthropic:api-key', () => {
  const catalog = getModelCatalog('anthropic', 'api-key');
  assert.ok(catalog);
  assert.equal(catalog.provider, 'anthropic');
});

test('getModelCatalog: returns correct catalog for openrouter:api-key', () => {
  const catalog = getModelCatalog('openrouter', 'api-key');
  assert.ok(catalog);
  assert.equal(catalog.provider, 'openrouter');
});

test('getModelCatalog: returns undefined for invalid combo', () => {
  assert.equal(getModelCatalog('openrouter', 'subscription'), undefined);
  assert.equal(getModelCatalog('invalid', 'api-key'), undefined);
});

// ─── MODEL_CATALOG ────────────────────────────────────────────────────────────

test('MODEL_CATALOG: all entries have required fields', () => {
  for (const [key, entry] of Object.entries(MODEL_CATALOG)) {
    assert.ok(entry.provider, `${key} missing provider`);
    assert.ok(entry.defaultModel, `${key} missing defaultModel`);
    assert.ok(Array.isArray(entry.menuModels), `${key} menuModels not array`);
    assert.ok(Array.isArray(entry.supportedModels), `${key} supportedModels not array`);
  }
});

// ─── normalizeConfig ──────────────────────────────────────────────────────────

test('normalizeConfig: defaults for empty config', () => {
  const result = normalizeConfig({});
  assert.equal(result.CLI_LANGUAGE, 'en');
  assert.equal(result.AUTH_MODE, 'api-key');
  assert.equal(result.MODEL_PROVIDER, 'anthropic');
  assert.equal(result.MODEL_NAME, 'claude-opus-4-6');
  assert.equal(result.TELEGRAM_ENABLED, 'false');
  assert.ok(result.GATEWAY_TOKEN, 'should generate a gateway token');
});

test('normalizeConfig: cfg values override defaults', () => {
  const result = normalizeConfig({
    language: 'es',
    authMode: 'subscription',
    provider: 'openai',
    modelName: 'gpt-5.4',
  });
  assert.equal(result.CLI_LANGUAGE, 'es');
  assert.equal(result.AUTH_MODE, 'subscription');
  assert.equal(result.MODEL_PROVIDER, 'openai');
  assert.equal(result.MODEL_NAME, 'gpt-5.4');
});

test('normalizeConfig: provider-specific key routing for openai', () => {
  const result = normalizeConfig({ provider: 'openai', apiKey: 'sk-test-key' });
  assert.equal(result.OPENAI_API_KEY, 'sk-test-key');
  assert.equal(result.ANTHROPIC_API_KEY, '');
  assert.equal(result.LLM_API_KEY, 'sk-test-key');
});

test('normalizeConfig: provider-specific key routing for anthropic', () => {
  const result = normalizeConfig({ provider: 'anthropic', apiKey: 'sk-ant-test' });
  assert.equal(result.ANTHROPIC_API_KEY, 'sk-ant-test');
  assert.equal(result.OPENAI_API_KEY, '');
  assert.equal(result.LLM_API_KEY, 'sk-ant-test');
});

test('normalizeConfig: existingEnv used as fallback', () => {
  const existing = {
    CLI_LANGUAGE: 'es',
    MODEL_PROVIDER: 'openai',
    GATEWAY_TOKEN: 'existing-token',
  };
  const result = normalizeConfig({}, existing);
  assert.equal(result.CLI_LANGUAGE, 'es');
  assert.equal(result.MODEL_PROVIDER, 'openai');
  assert.equal(result.GATEWAY_TOKEN, 'existing-token');
});

test('normalizeConfig: keepExisting preserves old keys', () => {
  const existing = {
    OPENAI_API_KEY: 'old-openai-key',
    ANTHROPIC_API_KEY: 'old-anthropic-key',
    LLM_API_KEY: 'old-llm-key',
    TELEGRAM_BOT_TOKEN: 'old-telegram',
  };
  const result = normalizeConfig({ keepExisting: true }, existing);
  assert.equal(result.OPENAI_API_KEY, 'old-openai-key');
  assert.equal(result.ANTHROPIC_API_KEY, 'old-anthropic-key');
  assert.equal(result.LLM_API_KEY, 'old-llm-key');
  assert.equal(result.TELEGRAM_BOT_TOKEN, 'old-telegram');
});

test('normalizeConfig: without keepExisting clears unrelated keys', () => {
  const existing = {
    OPENAI_API_KEY: 'old-openai-key',
    ANTHROPIC_API_KEY: 'old-anthropic-key',
    LLM_API_KEY: 'old-llm-key',
    TELEGRAM_BOT_TOKEN: 'old-telegram',
  };
  const result = normalizeConfig({}, existing);
  assert.equal(result.OPENAI_API_KEY, '');
  assert.equal(result.ANTHROPIC_API_KEY, '');
  assert.equal(result.LLM_API_KEY, '');
  assert.equal(result.TELEGRAM_BOT_TOKEN, '');
});

// ─── parseCallbackInput ──────────────────────────────────────────────────────

test('parseCallbackInput: full URL with code and state', () => {
  const result = parseCallbackInput('http://localhost:1455/auth/callback?code=abc123&state=xyz');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, 'xyz');
});

test('parseCallbackInput: URL without state', () => {
  const result = parseCallbackInput('http://localhost:1455/auth/callback?code=abc123');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, null);
});

test('parseCallbackInput: query string format', () => {
  const result = parseCallbackInput('code=abc123&state=xyz');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, 'xyz');
});

test('parseCallbackInput: query string with leading ?', () => {
  const result = parseCallbackInput('?code=abc123&state=xyz');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, 'xyz');
});

test('parseCallbackInput: bare code string', () => {
  const result = parseCallbackInput('abc123');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, null);
});

test('parseCallbackInput: whitespace trimming', () => {
  const result = parseCallbackInput('  abc123  ');
  assert.equal(result.code, 'abc123');
  assert.equal(result.state, null);
});

// ─── decodeJwtPayload ─────────────────────────────────────────────────────────

test('decodeJwtPayload: valid 3-part JWT decodes payload', () => {
  const payload = { sub: 'user123', email: 'test@example.com' };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `header.${encoded}.signature`;
  const result = decodeJwtPayload(token);
  assert.deepEqual(result, payload);
});

test('decodeJwtPayload: 1-part token returns empty object', () => {
  const result = decodeJwtPayload('single-part-token');
  assert.deepEqual(result, {});
});

test('decodeJwtPayload: JWT with nested OpenAI auth claim', () => {
  const payload = {
    sub: 'user123',
    'https://api.openai.com/auth': {
      user_id: 'user-abc',
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `header.${encoded}.signature`;
  const result = decodeJwtPayload(token);
  assert.deepEqual(result['https://api.openai.com/auth'], { user_id: 'user-abc' });
});

// ─── parseClaudeSetupToken ────────────────────────────────────────────────────

test('parseClaudeSetupToken: valid sk-ant-xxx accepted', () => {
  const token = 'sk-ant-abc123_DEF-456';
  assert.equal(parseClaudeSetupToken(token), token);
});

test('parseClaudeSetupToken: whitespace trimmed', () => {
  const token = '  sk-ant-abc123  ';
  assert.equal(parseClaudeSetupToken(token), 'sk-ant-abc123');
});

test('parseClaudeSetupToken: invalid format sk-abc returns null', () => {
  assert.equal(parseClaudeSetupToken('sk-abc'), null);
});

test('parseClaudeSetupToken: empty string returns null', () => {
  assert.equal(parseClaudeSetupToken(''), null);
});

test('parseClaudeSetupToken: special chars return null', () => {
  assert.equal(parseClaudeSetupToken('sk-ant-abc!@#'), null);
});

// ─── buildCodexAuthProfile ────────────────────────────────────────────────────

test('buildCodexAuthProfile: correct structure with email', () => {
  const profile = {
    email: 'user@example.com',
    access: 'access-token',
    refresh: 'refresh-token',
    expires: 1234567890,
    accountId: 'acct-123',
  };
  const result = buildCodexAuthProfile(profile);
  assert.equal(result.version, 1);
  const profileId = 'openai-codex:user@example.com';
  assert.ok(result.profiles[profileId]);
  assert.equal(result.profiles[profileId].type, 'oauth');
  assert.equal(result.profiles[profileId].provider, 'openai-codex');
  assert.equal(result.profiles[profileId].access, 'access-token');
  assert.equal(result.profiles[profileId].refresh, 'refresh-token');
  assert.equal(result.profiles[profileId].expires, 1234567890);
  assert.equal(result.profiles[profileId].accountId, 'acct-123');
});

test('buildCodexAuthProfile: default profileId without email', () => {
  const profile = { access: 'tok', refresh: 'ref', expires: 0 };
  const result = buildCodexAuthProfile(profile);
  assert.ok(result.profiles['openai-codex:default']);
});

// ─── buildAnthropicAuthProfile ────────────────────────────────────────────────

test('buildAnthropicAuthProfile: correct structure', () => {
  const result = buildAnthropicAuthProfile('sk-ant-test-token');
  assert.equal(result.version, 1);
  assert.ok(result.profiles['anthropic:token']);
  assert.equal(result.profiles['anthropic:token'].type, 'token');
  assert.equal(result.profiles['anthropic:token'].provider, 'anthropic');
  assert.equal(result.profiles['anthropic:token'].token, 'sk-ant-test-token');
});

test('buildAnthropicAuthProfile: order has anthropic key', () => {
  const result = buildAnthropicAuthProfile('sk-ant-test');
  assert.deepEqual(result.order, { anthropic: ['anthropic:token'] });
});

// ─── generatePKCE ─────────────────────────────────────────────────────────────

test('generatePKCE: returns verifier and challenge strings', () => {
  const pkce = generatePKCE();
  assert.equal(typeof pkce.verifier, 'string');
  assert.equal(typeof pkce.challenge, 'string');
  assert.ok(pkce.verifier.length > 0);
  assert.ok(pkce.challenge.length > 0);
});

test('generatePKCE: challenge is sha256 of verifier', () => {
  const pkce = generatePKCE();
  const expected = crypto.createHash('sha256').update(pkce.verifier).digest('base64url');
  assert.equal(pkce.challenge, expected);
});

test('generatePKCE: unique each call', () => {
  const a = generatePKCE();
  const b = generatePKCE();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});

// ─── buildOAuthUrl ────────────────────────────────────────────────────────────

test('buildOAuthUrl: URL includes response_type=code', () => {
  const pkce = generatePKCE();
  const url = buildOAuthUrl(pkce, 'test-state');
  assert.ok(url.includes('response_type=code'));
});

test('buildOAuthUrl: URL includes code_challenge', () => {
  const pkce = generatePKCE();
  const url = buildOAuthUrl(pkce, 'test-state');
  assert.ok(url.includes(`code_challenge=${encodeURIComponent(pkce.challenge)}`));
});

test('buildOAuthUrl: URL includes state', () => {
  const pkce = generatePKCE();
  const url = buildOAuthUrl(pkce, 'my-state-value');
  assert.ok(url.includes('state=my-state-value'));
});

test('buildOAuthUrl: URL includes client_id', () => {
  const pkce = generatePKCE();
  const url = buildOAuthUrl(pkce, 'state');
  assert.ok(url.includes('client_id='));
});
