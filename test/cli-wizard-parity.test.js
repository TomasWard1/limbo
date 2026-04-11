// test/cli-wizard-parity.test.js — Ensures CLI and setup wizard stay in sync.
// If this test fails, someone added a feature to one path without the other.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cli = require('../cli.js');
const wizard = require('../setup-server/server.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the env var keys that normalizeConfig produces (CLI path).
function cliEnvKeys() {
  const cfg = cli.normalizeConfig({
    language: 'en',
    authMode: 'api-key',
    provider: 'anthropic',
    modelName: 'claude-opus-4-6',
    apiKey: 'sk-ant-test',
    telegramEnabled: 'false',
    telegramToken: '',
    telegramAutoPair: 'true',
    voiceEnabled: 'false',
    webSearchEnabled: 'false',
    gatewayToken: 'test-token',
  });
  return new Set(Object.keys(cfg));
}

// Extract the env var keys the wizard writes in handleConfigure.
// We read the source and parse the envVars object keys.
function wizardEnvKeys() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'setup-server', 'server.js'),
    'utf8',
  );
  // Match the full-setup envVars = { ... } block inside handleConfigure.
  // switch-brain mode uses a separate block; we want the else (full setup) block
  // which contains all env vars. Match the last `envVars = {` occurrence.
  const matches = [...src.matchAll(/envVars\s*=\s*\{([^}]+)\}/g)];
  const match = matches.length > 0 ? matches[matches.length - 1] : null;
  assert.ok(match, 'could not find envVars block in setup-server/server.js');
  const keys = [];
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*:/);
    if (m) keys.push(m[1]);
  }
  return new Set(keys);
}

// Post-consolidation, both paths write secrets directly into .env as env vars.
// The parity check is therefore over env keys, not separate secret files.
const SECRET_ENV_KEYS = [
  'LLM_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'GATEWAY_TOKEN',
  'GROQ_API_KEY',
  'BRAVE_API_KEY',
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CLI ↔ Wizard parity', () => {

  // --- Env vars ---

  it('wizard writes every env var that CLI normalizeConfig produces', () => {
    const cliKeys = cliEnvKeys();
    const wizKeys = wizardEnvKeys();

    // OPENAI_API_KEY / ANTHROPIC_API_KEY / TELEGRAM_AUTO_PAIR_FIRST_DM are
    // CLI-only compat shims — the wizard never sets them directly.
    const cliOnly = new Set([
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'TELEGRAM_AUTO_PAIR_FIRST_DM',
    ]);
    const required = new Set([...cliKeys].filter(k => !cliOnly.has(k)));

    for (const key of required) {
      assert.ok(
        wizKeys.has(key),
        `CLI writes env var "${key}" but wizard does not. Add it to handleConfigure's envVars.`,
      );
    }
  });

  it('CLI writes every env var that wizard produces', () => {
    const cliKeys = cliEnvKeys();
    const wizKeys = wizardEnvKeys();

    for (const key of wizKeys) {
      assert.ok(
        cliKeys.has(key),
        `Wizard writes env var "${key}" but CLI normalizeConfig does not. Add it to normalizeConfig.`,
      );
    }
  });

  // --- Secrets (live inside .env after consolidation) ---

  it('both paths produce the same set of secret env vars', () => {
    const cliKeys = cliEnvKeys();
    const wizKeys = wizardEnvKeys();
    for (const key of SECRET_ENV_KEYS) {
      assert.ok(cliKeys.has(key), `CLI normalizeConfig must produce ${key}`);
      assert.ok(wizKeys.has(key), `Wizard handleConfigure must produce ${key}`);
    }
  });

  // --- Providers ---

  it('both paths support the same set of providers', () => {
    const cliProviders = new Set(
      Object.keys(cli.MODEL_CATALOG).map(k => k.split(':')[0]),
    );
    const wizProviders = new Set(Object.keys(wizard.MODEL_CATALOG));

    for (const p of cliProviders) {
      assert.ok(
        wizProviders.has(p),
        `CLI supports provider "${p}" but wizard MODEL_CATALOG does not.`,
      );
    }
    for (const p of wizProviders) {
      assert.ok(
        cliProviders.has(p),
        `Wizard supports provider "${p}" but CLI MODEL_CATALOG does not.`,
      );
    }
  });

  // --- Auth modes ---

  it('CLI MODEL_CATALOG covers both api-key and subscription for non-openrouter providers', () => {
    const cliKeys = Object.keys(cli.MODEL_CATALOG);
    for (const provider of ['openai', 'anthropic']) {
      assert.ok(
        cliKeys.includes(`${provider}:api-key`),
        `CLI missing "${provider}:api-key" catalog entry`,
      );
      assert.ok(
        cliKeys.includes(`${provider}:subscription`),
        `CLI missing "${provider}:subscription" catalog entry`,
      );
    }
  });

  // --- i18n ---

  it('CLI TEXT has the same keys in English and Spanish', () => {
    // We need to read the source to extract TEXT keys since TEXT is not exported
    const src = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');

    function extractTextKeys(lang) {
      // Find the start of the language block
      const blockStart = src.indexOf(`  ${lang}: {`);
      assert.ok(blockStart !== -1, `could not find TEXT.${lang} block`);
      // Find matching closing brace by counting braces
      let depth = 0;
      let start = -1;
      for (let i = blockStart; i < src.length; i++) {
        if (src[i] === '{') {
          if (start === -1) start = i;
          depth++;
        }
        if (src[i] === '}') {
          depth--;
          if (depth === 0) {
            const block = src.slice(start, i + 1);
            // Extract top-level keys (simple property names before :)
            const keys = [];
            for (const m of block.matchAll(/^\s{4}(\w+)\s*:/gm)) {
              keys.push(m[1]);
            }
            return new Set(keys);
          }
        }
      }
      assert.fail(`could not parse TEXT.${lang} block`);
    }

    const enKeys = extractTextKeys('en');
    const esKeys = extractTextKeys('es');

    for (const key of enKeys) {
      assert.ok(esKeys.has(key), `TEXT.en has key "${key}" but TEXT.es does not.`);
    }
    for (const key of esKeys) {
      assert.ok(enKeys.has(key), `TEXT.es has key "${key}" but TEXT.en does not.`);
    }
  });
});
