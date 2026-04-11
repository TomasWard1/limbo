/**
 * Unit tests for the secrets consolidation refactor.
 *
 * Goal: tokens live in ~/.limbo/config/.env (single source of truth),
 * NOT in separate ~/.limbo/secrets/ or openclaw-state/secrets/ files.
 *
 * Covers:
 *   1. cli.js source — no more SECRETS_DIR / writeSecretFile / readSecretFile
 *   2. compose output — no `secrets:` blocks
 *   3. migrateLegacySecretsToEnv — idempotent per-file migration
 *   4. writeEnv — pre-write backup to .env.bak
 *   5. ensureComposeFile — 0777 mode on CONFIG_DIR, no secrets dir
 *
 * Run: node --test test/cli-secrets-consolidation.test.js
 *
 * Strategy: spawn `node -e` drivers so each test gets its own module load
 * with a fresh LIMBO_HOME. cli.js computes LIMBO_DIR / CONFIG_DIR at require
 * time, so we can't share a module instance between tempdirs.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');
const CLI_SOURCE = fs.readFileSync(CLI_PATH, 'utf8');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpHome(prefix = 'limbo-secrets-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Spawn a node child that requires cli.js with LIMBO_HOME set, then
 * calls a named export. Returns { ok, stderr }.
 */
function runCliExport(homeDir, exportName, argsJson = '[]') {
  const driver = `
    process.env.LIMBO_HOME = ${JSON.stringify(homeDir)};
    const cli = require(${JSON.stringify(CLI_PATH)});
    const fn = cli[${JSON.stringify(exportName)}];
    if (typeof fn !== 'function') {
      console.error('MISSING_EXPORT:' + ${JSON.stringify(exportName)});
      process.exit(2);
    }
    const args = ${argsJson};
    fn.apply(null, args);
  `;
  try {
    execFileSync(process.execPath, ['-e', driver], {
      env: { ...process.env, LIMBO_HOME: homeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      stderr: (e.stderr || e.stdout || '').toString() + ' ' + (e.message || ''),
    };
  }
}

function writeSecret(dir, name, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), value);
}

// ─── 1. Source-level guarantees ─────────────────────────────────────────────

describe('cli.js source — secrets consolidation', () => {
  test('SECRETS_DIR constant is removed', () => {
    assert.ok(
      !/const\s+SECRETS_DIR\s*=/.test(CLI_SOURCE),
      'SECRETS_DIR const should be removed from cli.js'
    );
  });

  test('writeSecretFile function is removed', () => {
    assert.ok(
      !/function\s+writeSecretFile\s*\(/.test(CLI_SOURCE),
      'writeSecretFile should be removed from cli.js'
    );
  });

  test('readSecretFile function is removed', () => {
    assert.ok(
      !/function\s+readSecretFile\s*\(/.test(CLI_SOURCE),
      'readSecretFile should be removed from cli.js'
    );
  });

  test('writeSecrets function is removed', () => {
    assert.ok(
      !/function\s+writeSecrets\s*\(/.test(CLI_SOURCE),
      'writeSecrets should be removed from cli.js'
    );
  });

  test('no calls to writeSecretFile or readSecretFile remain', () => {
    assert.ok(
      !/\bwriteSecretFile\s*\(/.test(CLI_SOURCE),
      'No call sites of writeSecretFile should remain'
    );
    assert.ok(
      !/\breadSecretFile\s*\(/.test(CLI_SOURCE),
      'No call sites of readSecretFile should remain'
    );
  });

  test('migrateLegacySecretsToEnv function exists', () => {
    assert.ok(
      /function\s+migrateLegacySecretsToEnv\s*\(/.test(CLI_SOURCE),
      'migrateLegacySecretsToEnv should be defined in cli.js'
    );
  });

  test('ensureComposeFile calls migrateLegacySecretsToEnv', () => {
    const fnIdx = CLI_SOURCE.indexOf('function ensureComposeFile');
    assert.ok(fnIdx !== -1, 'ensureComposeFile function must exist');
    const tail = CLI_SOURCE.slice(fnIdx, fnIdx + 4000);
    assert.ok(
      tail.includes('migrateLegacySecretsToEnv'),
      'ensureComposeFile should call migrateLegacySecretsToEnv'
    );
  });

  test('migrateLegacySecretsToEnv and ensureComposeFile are exported', () => {
    // module.exports object assertion by text match.
    const exportsIdx = CLI_SOURCE.indexOf('module.exports');
    assert.ok(exportsIdx !== -1, 'module.exports must exist');
    const exportsBlock = CLI_SOURCE.slice(exportsIdx, exportsIdx + 2000);
    assert.ok(exportsBlock.includes('migrateLegacySecretsToEnv'), 'migrateLegacySecretsToEnv must be exported');
    assert.ok(exportsBlock.includes('ensureComposeFile'), 'ensureComposeFile must be exported');
    assert.ok(exportsBlock.includes('writeEnv'), 'writeEnv must be exported');
  });
});

// ─── 2. Compose output ──────────────────────────────────────────────────────

describe('compose output — no secrets blocks', () => {
  function extractComposeOutput(fnName) {
    const fnStart = CLI_SOURCE.indexOf(`function ${fnName}()`);
    if (fnStart === -1) throw new Error(`Function ${fnName} not found`);
    const returnIdx = CLI_SOURCE.indexOf('return `', fnStart);
    const backtickStart = CLI_SOURCE.indexOf('`', returnIdx);
    let depth = 0;
    let i = backtickStart + 1;
    while (i < CLI_SOURCE.length) {
      if (CLI_SOURCE[i] === '\\') { i += 2; continue; }
      if (CLI_SOURCE[i] === '$' && CLI_SOURCE[i + 1] === '{') { depth++; i += 2; continue; }
      if (depth > 0 && CLI_SOURCE[i] === '}') { depth--; i++; continue; }
      if (CLI_SOURCE[i] === '`' && depth === 0) break;
      i++;
    }
    return CLI_SOURCE.slice(backtickStart + 1, i);
  }

  const normalTemplate = extractComposeOutput('composeContent');
  const hardenedTemplate = extractComposeOutput('composeContentHardened');

  test('composeContent has no top-level `secrets:` block', () => {
    assert.ok(
      !/\nsecrets:\s*\n/.test(normalTemplate),
      'Normal compose must not declare a top-level `secrets:` block'
    );
  });

  test('composeContent has no service-level `secrets:` list', () => {
    assert.ok(
      !/\n\s+secrets:\s*\n\s+-\s+llm_api_key/.test(normalTemplate),
      'Normal compose must not list `- llm_api_key` under the service'
    );
  });

  test('composeContentHardened has no top-level `secrets:` block', () => {
    assert.ok(
      !/\nsecrets:\s*\n/.test(hardenedTemplate),
      'Hardened compose must not declare a top-level `secrets:` block'
    );
  });

  test('composeContentHardened has no service-level `secrets:` list', () => {
    assert.ok(
      !/\n\s+secrets:\s*\n\s+-\s+llm_api_key/.test(hardenedTemplate),
      'Hardened compose must not list `- llm_api_key` under the service'
    );
  });

  test('composeContent still references env_file', () => {
    assert.ok(
      /env_file:/.test(normalTemplate),
      'env_file must remain (it is now the only secret source)'
    );
  });

  test('composeContentHardened still references env_file', () => {
    assert.ok(
      /env_file:/.test(hardenedTemplate),
      'Hardened env_file must remain'
    );
  });
});

// ─── 3. Migration behavior ──────────────────────────────────────────────────

describe('migrateLegacySecretsToEnv behavior', () => {
  test('migrates from ~/.limbo/secrets/ into .env', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      fs.writeFileSync(path.join(home, 'config', '.env'), 'CLI_LANGUAGE=en\n');
      writeSecret(path.join(home, 'secrets'), 'llm_api_key', 'sk-legacy-new');
      writeSecret(path.join(home, 'secrets'), 'telegram_bot_token', 'tg-legacy-new');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.LLM_API_KEY, 'sk-legacy-new');
      assert.equal(env.TELEGRAM_BOT_TOKEN, 'tg-legacy-new');
      assert.equal(env.CLI_LANGUAGE, 'en', 'pre-existing keys must be preserved');
    } finally {
      cleanup();
    }
  });

  test('migrates from ~/.limbo/zeroclaw-state/secrets/ into .env', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      writeSecret(path.join(home, 'zeroclaw-state', 'secrets'), 'groq_api_key', 'gsk-legacy');
      writeSecret(path.join(home, 'zeroclaw-state', 'secrets'), 'brave_api_key', 'BSA-legacy');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.GROQ_API_KEY, 'gsk-legacy');
      assert.equal(env.BRAVE_API_KEY, 'BSA-legacy');
    } finally {
      cleanup();
    }
  });

  test('newer ~/.limbo/secrets/ wins over older zeroclaw-state/secrets/', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      writeSecret(path.join(home, 'secrets'), 'llm_api_key', 'sk-NEWER');
      writeSecret(path.join(home, 'zeroclaw-state', 'secrets'), 'llm_api_key', 'sk-OLDER');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.LLM_API_KEY, 'sk-NEWER');
    } finally {
      cleanup();
    }
  });

  test('does not overwrite a value already in .env', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      fs.writeFileSync(path.join(home, 'config', '.env'), 'LLM_API_KEY=sk-CURRENT\n');
      writeSecret(path.join(home, 'secrets'), 'llm_api_key', 'sk-LEGACY');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.LLM_API_KEY, 'sk-CURRENT', 'must not overwrite current value');
    } finally {
      cleanup();
    }
  });

  test('is idempotent — second call makes no changes', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      writeSecret(path.join(home, 'secrets'), 'llm_api_key', 'sk-once');

      assert.ok(runCliExport(home, 'migrateLegacySecretsToEnv').ok, 'first call');
      const envPath = path.join(home, 'config', '.env');
      const firstContent = fs.readFileSync(envPath, 'utf8');

      assert.ok(runCliExport(home, 'migrateLegacySecretsToEnv').ok, 'second call');
      const secondContent = fs.readFileSync(envPath, 'utf8');

      assert.equal(firstContent, secondContent, 'second run must produce identical .env');
    } finally {
      cleanup();
    }
  });

  test('handles missing source dirs gracefully', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(home, { recursive: true });
      // No secrets/ or zeroclaw-state/ at all
      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'should not fail on missing dirs: ' + (result.stderr || ''));
    } finally {
      cleanup();
    }
  });
});

// ─── 4. writeEnv backup behavior ────────────────────────────────────────────

describe('writeEnv — .env.bak pre-write', () => {
  const simpleCfg = {
    language: 'en',
    provider: 'anthropic',
    modelName: 'claude-opus-4-6',
    apiKey: 'sk-new',
  };

  test('creates .env.bak when a prior .env exists', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      const envPath = path.join(home, 'config', '.env');
      fs.writeFileSync(envPath, 'MODEL_PROVIDER=anthropic\nLLM_API_KEY=sk-original\n');

      const result = runCliExport(home, 'writeEnv', JSON.stringify([simpleCfg]));
      assert.ok(result.ok, 'writeEnv should succeed: ' + (result.stderr || ''));

      const bakPath = envPath + '.bak';
      assert.ok(fs.existsSync(bakPath), '.env.bak must be created');
      const bakContent = fs.readFileSync(bakPath, 'utf8');
      assert.ok(bakContent.includes('sk-original'), '.env.bak must contain prior content');
    } finally {
      cleanup();
    }
  });

  test('does not create .env.bak when no prior .env exists', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      const envPath = path.join(home, 'config', '.env');

      const result = runCliExport(home, 'writeEnv', JSON.stringify([simpleCfg]));
      assert.ok(result.ok, 'writeEnv should succeed: ' + (result.stderr || ''));

      assert.ok(!fs.existsSync(envPath + '.bak'), '.env.bak must not exist on first write');
    } finally {
      cleanup();
    }
  });

  test('overwrites .env.bak on subsequent writes', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      const envPath = path.join(home, 'config', '.env');
      fs.writeFileSync(envPath, 'LLM_API_KEY=sk-v1\n');

      runCliExport(home, 'writeEnv', JSON.stringify([{ ...simpleCfg, apiKey: 'sk-v2' }]));
      assert.ok(fs.readFileSync(envPath + '.bak', 'utf8').includes('sk-v1'));

      runCliExport(home, 'writeEnv', JSON.stringify([{ ...simpleCfg, apiKey: 'sk-v3' }]));
      const bakContent = fs.readFileSync(envPath + '.bak', 'utf8');
      assert.ok(bakContent.includes('sk-v2'), '.env.bak must be updated to hold v2');
      assert.ok(!bakContent.includes('sk-v1'), '.env.bak must no longer hold v1');
    } finally {
      cleanup();
    }
  });

  test('tokens live inside .env (not in a separate secrets/ dir)', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      const envPath = path.join(home, 'config', '.env');

      const result = runCliExport(
        home,
        'writeEnv',
        JSON.stringify([{ ...simpleCfg, apiKey: 'sk-inside-env' }])
      );
      assert.ok(result.ok, 'writeEnv should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(envPath);
      assert.equal(env.LLM_API_KEY, 'sk-inside-env', 'token must be in .env');
      assert.ok(
        !fs.existsSync(path.join(home, 'secrets', 'llm_api_key')),
        'Legacy ~/.limbo/secrets/llm_api_key must NOT be created'
      );
    } finally {
      cleanup();
    }
  });
});

// ─── 5. ensureComposeFile behavior ──────────────────────────────────────────

describe('ensureComposeFile — perms and layout', () => {
  test('CONFIG_DIR is created with mode 0o777', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');

      const result = runCliExport(home, 'ensureComposeFile', '[false]');
      assert.ok(result.ok, 'ensureComposeFile should succeed: ' + (result.stderr || ''));

      const stat = fs.statSync(path.join(home, 'config'));
      const mode = stat.mode & 0o777;
      assert.equal(mode, 0o777, `CONFIG_DIR mode must be 0o777 (got 0o${mode.toString(8)})`);
    } finally {
      cleanup();
    }
  });

  test('does NOT create ~/.limbo/secrets/ directory', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');

      const result = runCliExport(home, 'ensureComposeFile', '[false]');
      assert.ok(result.ok, 'ensureComposeFile should succeed: ' + (result.stderr || ''));

      assert.ok(
        !fs.existsSync(path.join(home, 'secrets')),
        '~/.limbo/secrets/ must not be created'
      );
    } finally {
      cleanup();
    }
  });

  test('generates docker-compose.yml without secrets blocks', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');

      const result = runCliExport(home, 'ensureComposeFile', '[false]');
      assert.ok(result.ok, 'ensureComposeFile should succeed: ' + (result.stderr || ''));

      const compose = fs.readFileSync(path.join(home, 'docker-compose.yml'), 'utf8');
      assert.ok(!/\nsecrets:\s*\n/.test(compose), 'generated compose must not have top-level secrets block');
      assert.ok(
        !/\n\s+secrets:\s*\n\s+-\s+llm_api_key/.test(compose),
        'generated compose must not have service-level secrets list'
      );
      assert.ok(compose.includes('env_file'), 'generated compose must still have env_file');
    } finally {
      cleanup();
    }
  });
});

// ─── 6. safeWriteEnvFile — mode 0o666 + container-writable ─────────────────

describe('safeWriteEnvFile — .env mode after writes', () => {
  test('exports safeWriteEnvFile helper', () => {
    assert.ok(
      /function\s+safeWriteEnvFile\s*\(/.test(CLI_SOURCE),
      'safeWriteEnvFile helper should exist in cli.js'
    );
    const exportsIdx = CLI_SOURCE.indexOf('module.exports');
    const exportsBlock = CLI_SOURCE.slice(exportsIdx, exportsIdx + 2000);
    assert.ok(
      exportsBlock.includes('safeWriteEnvFile'),
      'safeWriteEnvFile must be exported for test access'
    );
  });

  test('exactly one fs.writeFileSync(ENV_FILE, ...) call site remains', () => {
    // After the refactor every other writer should funnel through
    // safeWriteEnvFile. This guards against regressions where a future
    // change re-introduces a 0o600 (host-only) write that breaks the
    // container's ability to rewrite the .env. Strip line comments first
    // so a `// fs.writeFileSync(ENV_FILE, ...)` mention in a docstring
    // doesn't trip the count.
    const codeOnly = CLI_SOURCE
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/.*$/, ''))
      .join('\n');
    const matches = codeOnly.match(/fs\.writeFileSync\(ENV_FILE\b/g) || [];
    assert.equal(
      matches.length,
      1,
      `expected exactly one fs.writeFileSync(ENV_FILE, ...) call site, found ${matches.length}`
    );
  });

  test('safeWriteEnvFile writes .env with mode 0o666', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      const envPath = path.join(home, 'config', '.env');

      const result = runCliExport(
        home,
        'safeWriteEnvFile',
        JSON.stringify(['LLM_API_KEY=sk-test\n'])
      );
      assert.ok(result.ok, 'safeWriteEnvFile should succeed: ' + (result.stderr || ''));

      assert.ok(fs.existsSync(envPath), '.env must be created');
      const stat = fs.statSync(envPath);
      const mode = stat.mode & 0o777;
      assert.equal(
        mode,
        0o666,
        `.env mode must be 0o666 (got 0o${mode.toString(8)}) so the uid 999 container can rewrite it`
      );
    } finally {
      cleanup();
    }
  });

  test('repeated safeWriteEnvFile calls keep mode 0o666 (cmdSwitchBrain-style)', () => {
    // cmdSwitchBrain reads .env, mutates it, writes it back. Simulate that
    // sequence: an initial write (mode should be 0666), then a follow-up
    // overwrite (mode should still be 0666). This guards against C2 — the
    // pre-fix code wrote with mode 0o600 here, breaking the container.
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      const envPath = path.join(home, 'config', '.env');

      assert.ok(
        runCliExport(home, 'safeWriteEnvFile', JSON.stringify(['MODEL_PROVIDER=anthropic\n'])).ok
      );
      assert.ok(
        runCliExport(
          home,
          'safeWriteEnvFile',
          JSON.stringify(['MODEL_PROVIDER=anthropic\nSWITCH_BRAIN_MODE=true\n'])
        ).ok
      );

      const mode = fs.statSync(envPath).mode & 0o777;
      assert.equal(mode, 0o666, `mode must remain 0o666 after a cmdSwitchBrain-style rewrite (got 0o${mode.toString(8)})`);
    } finally {
      cleanup();
    }
  });

  test('reconfigure-cleanup style write keeps mode 0o666', () => {
    // cmdStart's post-wizard cleanup reads .env, strips FORCE_SETUP_MODE=,
    // writes it back. The pre-fix path wrote mode 0o600 — breaking the
    // container's ability to update .env on next boot.
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      const envPath = path.join(home, 'config', '.env');

      assert.ok(
        runCliExport(
          home,
          'safeWriteEnvFile',
          JSON.stringify(['CLI_LANGUAGE=en\nLIMBO_PORT=18900\nFORCE_SETUP_MODE=true\n'])
        ).ok
      );
      // Cleanup write — strips FORCE_SETUP_MODE.
      assert.ok(
        runCliExport(
          home,
          'safeWriteEnvFile',
          JSON.stringify(['CLI_LANGUAGE=en\nLIMBO_PORT=18900\n'])
        ).ok
      );

      const mode = fs.statSync(envPath).mode & 0o777;
      assert.equal(mode, 0o666, `mode must remain 0o666 after reconfigure cleanup (got 0o${mode.toString(8)})`);
      const env = parseEnvFile(envPath);
      assert.ok(!('FORCE_SETUP_MODE' in env), 'FORCE_SETUP_MODE should be stripped');
    } finally {
      cleanup();
    }
  });
});

// ─── 7. migrateLegacySecretsToEnv — completeness ───────────────────────────

describe('migrateLegacySecretsToEnv — extended secret coverage', () => {
  test('migrates google_client_id and google_client_secret', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      writeSecret(path.join(home, 'secrets'), 'google_client_id', 'gci-legacy');
      writeSecret(path.join(home, 'secrets'), 'google_client_secret', 'gcs-legacy');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.GOOGLE_CLIENT_ID, 'gci-legacy');
      assert.equal(env.GOOGLE_CLIENT_SECRET, 'gcs-legacy');
    } finally {
      cleanup();
    }
  });

  test('migrates telegram_chat_id', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      writeSecret(path.join(home, 'openclaw-state', 'secrets'), 'telegram_chat_id', '1234567890');

      const result = runCliExport(home, 'migrateLegacySecretsToEnv');
      assert.ok(result.ok, 'migration should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.TELEGRAM_CHAT_ID, '1234567890');
    } finally {
      cleanup();
    }
  });
});

// ─── 8. writeMinimalEnv — merge with migrated secrets ──────────────────────

describe('writeMinimalEnv — merge behavior', () => {
  test('preserves a pre-existing LLM_API_KEY in .env', () => {
    // Guard against I4 — the pre-fix writeMinimalEnv built a 3-line .env
    // from scratch and clobbered LLM_API_KEY (and any other secret) that
    // migrateLegacySecretsToEnv had just populated.
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      fs.mkdirSync(path.join(home, 'config'), { recursive: true });
      const envPath = path.join(home, 'config', '.env');
      fs.writeFileSync(
        envPath,
        'LLM_API_KEY=sk-preserve-me\nTELEGRAM_BOT_TOKEN=tg-preserve-me\nGATEWAY_TOKEN=gw-existing\n'
      );

      const result = runCliExport(home, 'writeMinimalEnv');
      assert.ok(result.ok, 'writeMinimalEnv should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(envPath);
      assert.equal(env.LLM_API_KEY, 'sk-preserve-me', 'LLM_API_KEY must be preserved');
      assert.equal(env.TELEGRAM_BOT_TOKEN, 'tg-preserve-me', 'TELEGRAM_BOT_TOKEN must be preserved');
      assert.equal(env.GATEWAY_TOKEN, 'gw-existing', 'GATEWAY_TOKEN must be preserved when set');
      assert.ok(env.CLI_LANGUAGE, 'CLI_LANGUAGE must be set');
      assert.ok(env.LIMBO_PORT, 'LIMBO_PORT must be set');
    } finally {
      cleanup();
    }
  });

  test('preserves migrated secrets after running on a legacy install', () => {
    // End-to-end I4 check: legacy secret files exist, no .env yet.
    // writeMinimalEnv() calls ensureComposeFile() which migrates the
    // secrets, then merges in CLI_LANGUAGE/LIMBO_PORT/GATEWAY_TOKEN.
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');
      writeSecret(path.join(home, 'secrets'), 'llm_api_key', 'sk-migrated');
      writeSecret(path.join(home, 'secrets'), 'telegram_bot_token', 'tg-migrated');

      const result = runCliExport(home, 'writeMinimalEnv');
      assert.ok(result.ok, 'writeMinimalEnv should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.equal(env.LLM_API_KEY, 'sk-migrated', 'migrated LLM_API_KEY must survive writeMinimalEnv');
      assert.equal(env.TELEGRAM_BOT_TOKEN, 'tg-migrated', 'migrated TELEGRAM_BOT_TOKEN must survive');
      assert.ok(env.GATEWAY_TOKEN, 'GATEWAY_TOKEN must be generated');
    } finally {
      cleanup();
    }
  });

  test('generates a fresh GATEWAY_TOKEN when none exists', () => {
    const { dir, cleanup } = makeTmpHome();
    try {
      const home = path.join(dir, '.limbo');

      const result = runCliExport(home, 'writeMinimalEnv');
      assert.ok(result.ok, 'writeMinimalEnv should succeed: ' + (result.stderr || ''));

      const env = parseEnvFile(path.join(home, 'config', '.env'));
      assert.ok(env.GATEWAY_TOKEN && env.GATEWAY_TOKEN.length >= 16, 'GATEWAY_TOKEN must be generated');
      assert.ok(env.CLI_LANGUAGE, 'CLI_LANGUAGE must be set');
      assert.ok(env.LIMBO_PORT, 'LIMBO_PORT must be set');
    } finally {
      cleanup();
    }
  });
});
