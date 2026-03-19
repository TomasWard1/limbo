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
  // Match the envVars = { ... } block inside handleConfigure
  const match = src.match(/const envVars\s*=\s*\{([^}]+)\}/);
  assert.ok(match, 'could not find envVars block in setup-server/server.js');
  const keys = [];
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*:/);
    if (m) keys.push(m[1]);
  }
  return new Set(keys);
}

// Extract secret file names written by each path.
function cliSecretNames() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
  // writeSecrets function writes these secret files
  const match = src.match(/function writeSecrets[\s\S]*?^}/m);
  assert.ok(match, 'could not find writeSecrets in cli.js');
  const names = [];
  for (const m of match[0].matchAll(/writeSecretFile\(['"]([^'"]+)['"]/g)) {
    names.push(m[1]);
  }
  return new Set(names);
}

function wizardSecretNames() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'setup-server', 'server.js'),
    'utf8',
  );
  // handleConfigure writes secrets via writeSecretFile
  const match = src.match(/async function handleConfigure[\s\S]*?^}/m);
  assert.ok(match, 'could not find handleConfigure in setup-server/server.js');
  const names = [];
  for (const m of match[0].matchAll(/writeSecretFile\(['"]([^'"]+)['"]/g)) {
    names.push(m[1]);
  }
  // gateway_token is written via ensureGatewayToken, not directly
  names.push('gateway_token');
  return new Set(names);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CLI ↔ Wizard parity', () => {

  // --- Env vars ---

  it('wizard writes every env var that CLI normalizeConfig produces (minus secrets)', () => {
    const cliKeys = cliEnvKeys();
    const wizKeys = wizardEnvKeys();

    // CLI normalizeConfig includes secret-adjacent keys (LLM_API_KEY, OPENAI_API_KEY, etc.)
    // that the wizard writes to secret files instead of .env. Filter those out.
    const secretAdjacentKeys = new Set([
      'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'TELEGRAM_BOT_TOKEN', 'GATEWAY_TOKEN',
      // TELEGRAM_AUTO_PAIR_FIRST_DM is set by CLI but wizard handles auto-pair implicitly
      'TELEGRAM_AUTO_PAIR_FIRST_DM',
    ]);

    const cliNonSecret = new Set([...cliKeys].filter(k => !secretAdjacentKeys.has(k)));

    for (const key of cliNonSecret) {
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

  // --- Secrets ---

  it('both paths write the same secret files', () => {
    const cliSec = cliSecretNames();
    const wizSec = wizardSecretNames();

    for (const name of cliSec) {
      assert.ok(
        wizSec.has(name),
        `CLI writes secret "${name}" but wizard does not. Add writeSecretFile('${name}', ...) to handleConfigure.`,
      );
    }
    for (const name of wizSec) {
      assert.ok(
        cliSec.has(name),
        `Wizard writes secret "${name}" but CLI does not. Add writeSecretFile('${name}', ...) to writeSecrets.`,
      );
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
