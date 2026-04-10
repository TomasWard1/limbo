// test/entrypoint.test.js
// Unit tests for scripts/entrypoint.sh logic (config generation, secret resolution,
// workspace bootstrapping, provider remapping).
// Run with: node --test test/entrypoint.test.js
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEMPLATE_PATH = path.join(__dirname, '..', 'openclaw.json.template');
const USER_TEMPLATE_PATH = path.join(__dirname, '..', 'workspace', 'templates', 'USER.md.template');

/** Create a temp dir that auto-cleans via the returned cleanup fn */
function makeTmpDir(prefix = 'limbo-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Simulate `envsubst` — replace $VAR and ${VAR} with values from env map.
 * Only replaces vars listed in allowedVars (matches shell envsubst behavior).
 */
function envsubst(template, env, allowedVars) {
  let result = template;
  for (const v of allowedVars) {
    const val = env[v] ?? '';
    result = result.replace(new RegExp(`\\$\\{${v}\\}`, 'g'), val);
    result = result.replace(new RegExp(`\\$${v}(?![A-Za-z0-9_])`, 'g'), val);
  }
  return result;
}

/**
 * Replicate the entrypoint.sh `read_secret` logic in JS.
 * Priority: dockerSecretsDir > ocSecretsDir > envValue
 */
function readSecret(name, dockerSecretsDir, ocSecretsDir, envValue) {
  const dockerPath = path.join(dockerSecretsDir, name);
  if (fs.existsSync(dockerPath)) {
    const stat = fs.statSync(dockerPath);
    if (stat.size > 0) {
      try { return fs.readFileSync(dockerPath, 'utf8'); } catch { /* not readable */ }
    }
  }
  const ocPath = path.join(ocSecretsDir, name);
  if (fs.existsSync(ocPath)) {
    const stat = fs.statSync(ocPath);
    if (stat.size > 0) {
      try { return fs.readFileSync(ocPath, 'utf8'); } catch { /* not readable */ }
    }
  }
  return envValue || '';
}

/**
 * Run a node -e inline script against a config file.
 * Uses execFileSync (no shell) to avoid injection and satisfy linting.
 */
function runNodeInject(script, cfgPath, envOverrides = {}) {
  execFileSync(process.execPath, ['-e', script, cfgPath], {
    env: { ...process.env, ...envOverrides },
  });
}

// ── 1. Config generation ────────────────────────────────────────────────────

describe('Config generation (openclaw.json.template)', () => {
  const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const CONFIG_VARS = ['MODEL_PROVIDER', 'MODEL_NAME', 'LIMBO_PORT', 'RUNTIME_REASONING_EFFORT', 'OPENCLAW_STATE_DIR'];

  test('template is valid after envsubst with typical values', () => {
    const env = {
      MODEL_PROVIDER: 'anthropic',
      MODEL_NAME: 'claude-opus-4-6',
      LIMBO_PORT: '18789',
      RUNTIME_REASONING_EFFORT: 'medium',
      OPENCLAW_STATE_DIR: '/home/limbo/.openclaw',
    };
    const rendered = envsubst(TEMPLATE, env, CONFIG_VARS);
    const cfg = JSON.parse(rendered);
    assert.equal(cfg.agents.defaults.model.primary, 'anthropic/claude-opus-4-6');
    assert.equal(cfg.gateway.port, 18789);
    assert.equal(cfg.agents.defaults.thinkingDefault, 'medium');
    assert.equal(cfg.gateway.auth.token, '');
    assert.deepEqual(cfg.channels, {});
  });

  test('template with openai provider produces correct model path', () => {
    const env = {
      MODEL_PROVIDER: 'openai',
      MODEL_NAME: 'gpt-4o',
      LIMBO_PORT: '3000',
      RUNTIME_REASONING_EFFORT: 'high',
      OPENCLAW_STATE_DIR: '/tmp/oc',
    };
    const rendered = envsubst(TEMPLATE, env, CONFIG_VARS);
    const cfg = JSON.parse(rendered);
    assert.equal(cfg.agents.defaults.model.primary, 'openai/gpt-4o');
    assert.equal(cfg.gateway.port, 3000);
  });

  test('template with openrouter provider', () => {
    const env = {
      MODEL_PROVIDER: 'openrouter',
      MODEL_NAME: 'anthropic/claude-3.5-sonnet',
      LIMBO_PORT: '18789',
      RUNTIME_REASONING_EFFORT: 'low',
      OPENCLAW_STATE_DIR: '/data/oc',
    };
    const rendered = envsubst(TEMPLATE, env, CONFIG_VARS);
    const cfg = JSON.parse(rendered);
    assert.equal(cfg.agents.defaults.model.primary, 'openrouter/anthropic/claude-3.5-sonnet');
  });

  test('MCP server env vars use OPENCLAW_STATE_DIR', () => {
    const env = {
      MODEL_PROVIDER: 'anthropic',
      MODEL_NAME: 'claude-opus-4-6',
      LIMBO_PORT: '18789',
      RUNTIME_REASONING_EFFORT: 'medium',
      OPENCLAW_STATE_DIR: '/custom/path',
    };
    const rendered = envsubst(TEMPLATE, env, CONFIG_VARS);
    const cfg = JSON.parse(rendered);
    assert.equal(cfg.mcp.servers['limbo-vault'].env.OPENCLAW_STATE_DIR, '/custom/path');
    assert.equal(cfg.mcp.servers['limbo-vault'].env.OPENCLAW_WORKSPACE_DIR, '/custom/path/workspace');
  });
});

// ── 1b. Node -e injection scripts ──────────────────────────────────────────

describe('Config injection (node -e scripts)', () => {
  let tmp;

  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  /** Write a base config and return its path */
  function writeBaseConfig(extra = {}) {
    const base = {
      gateway: { mode: 'local', port: 18789, bind: '0.0.0.0', auth: { mode: 'token', token: '' } },
      channels: {},
      ...extra,
    };
    const p = path.join(tmp.dir, `cfg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, JSON.stringify(base, null, 2));
    return p;
  }

  const GATEWAY_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.gateway.auth.token = process.env.GATEWAY_TOKEN || '';
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;

  const TELEGRAM_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.channels = cfg.channels || {};
    cfg.channels.telegram = {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      allowFrom: ['*']
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;

  // Voice: OpenClaw auto-detects GROQ_API_KEY from env — no config injection needed.
  // We test that the entrypoint exports the env var, not that it injects config.

  const WEB_SEARCH_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.tools = cfg.tools || {};
    cfg.tools.web = cfg.tools.web || {};
    cfg.tools.web.search = {
      enabled: true,
      provider: 'brave',
      maxResults: 5
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;

  test('gateway token injection', () => {
    const cfgPath = writeBaseConfig();
    const token = 'my-secret-gateway-token-123';
    runNodeInject(GATEWAY_SCRIPT, cfgPath, { GATEWAY_TOKEN: token });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.gateway.auth.token, token);
  });

  test('gateway token with special characters (quotes, backslashes, dollars)', () => {
    const cfgPath = writeBaseConfig();
    const token = 'tok"en\\with$pecial\\chars"and\'quotes';
    runNodeInject(GATEWAY_SCRIPT, cfgPath, { GATEWAY_TOKEN: token });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.gateway.auth.token, token);
  });

  test('empty gateway token writes empty string', () => {
    const cfgPath = writeBaseConfig();
    runNodeInject(GATEWAY_SCRIPT, cfgPath, { GATEWAY_TOKEN: '' });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.gateway.auth.token, '');
  });

  test('telegram injection adds channel config', () => {
    const cfgPath = writeBaseConfig();
    const botToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    runNodeInject(TELEGRAM_SCRIPT, cfgPath, { TELEGRAM_BOT_TOKEN: botToken });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.channels.telegram.enabled, true);
    assert.equal(cfg.channels.telegram.botToken, botToken);
    assert.deepEqual(cfg.channels.telegram.allowFrom, ['*']);
  });

  test('telegram token with special characters', () => {
    const cfgPath = writeBaseConfig();
    const botToken = 'tok"en:with\\special$chars';
    runNodeInject(TELEGRAM_SCRIPT, cfgPath, { TELEGRAM_BOT_TOKEN: botToken });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.channels.telegram.botToken, botToken);
  });

  test('voice transcription uses env var, not config injection', () => {
    // OpenClaw auto-detects GROQ_API_KEY from env — no config keys needed
    const cfgPath = writeBaseConfig();
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(!cfg.transcription, 'Config should NOT have top-level transcription key');
    assert.ok(!cfg.audio, 'Voice is handled via GROQ_API_KEY env var, not config');
  });

  test('web search injection adds tools.web.search config', () => {
    const cfgPath = writeBaseConfig();
    const braveKey = 'BSA_test_brave_key';
    runNodeInject(WEB_SEARCH_SCRIPT, cfgPath, { BRAVE_API_KEY: braveKey });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.tools.web.search.enabled, true);
    assert.equal(cfg.tools.web.search.provider, 'brave');
    assert.equal(cfg.tools.web.search.maxResults, 5);
  });

  test('all injections compose correctly (gateway + telegram + voice + web)', () => {
    const cfgPath = writeBaseConfig();
    const gatewayToken = 'gw-tok-123';
    const telegramToken = '999:AAAA-bbbb';
    const groqKey = 'gsk_compose_test';
    const braveKey = 'BSA_compose_test';

    runNodeInject(GATEWAY_SCRIPT, cfgPath, { GATEWAY_TOKEN: gatewayToken });
    runNodeInject(TELEGRAM_SCRIPT, cfgPath, { TELEGRAM_BOT_TOKEN: telegramToken });
    // Voice: no injection — GROQ_API_KEY is env-only
    runNodeInject(WEB_SEARCH_SCRIPT, cfgPath, { BRAVE_API_KEY: braveKey });

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.gateway.auth.token, gatewayToken);
    assert.equal(cfg.channels.telegram.botToken, telegramToken);
    assert.equal(cfg.tools.web.search.enabled, true);
    assert.ok(!cfg.transcription, 'No top-level transcription key');
    assert.ok(!cfg.webSearch, 'No top-level webSearch key');
    // Original fields preserved
    assert.equal(cfg.gateway.mode, 'local');
    assert.equal(cfg.gateway.port, 18789);
  });
});

// ── 2. Secret resolution priority ──────────────────────────────────────────

describe('Secret resolution priority (read_secret)', () => {
  let tmp;

  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  test('Docker secret takes priority over OpenClaw secret', () => {
    const dockerDir = path.join(tmp.dir, 'run-secrets');
    const ocDir = path.join(tmp.dir, 'oc-secrets');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });
    fs.writeFileSync(path.join(dockerDir, 'llm_api_key'), 'docker-key');
    fs.writeFileSync(path.join(ocDir, 'llm_api_key'), 'oc-key');

    assert.equal(readSecret('llm_api_key', dockerDir, ocDir, 'env-key'), 'docker-key');
  });

  test('OpenClaw secret used when Docker secret missing', () => {
    const dockerDir = path.join(tmp.dir, 'empty-docker');
    const ocDir = path.join(tmp.dir, 'oc-secrets-2');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });
    fs.writeFileSync(path.join(ocDir, 'llm_api_key'), 'oc-key');

    assert.equal(readSecret('llm_api_key', dockerDir, ocDir, 'env-key'), 'oc-key');
  });

  test('env value used when no secret files exist', () => {
    const dockerDir = path.join(tmp.dir, 'no-docker');
    const ocDir = path.join(tmp.dir, 'no-oc');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });

    assert.equal(readSecret('llm_api_key', dockerDir, ocDir, 'env-key'), 'env-key');
  });

  test('empty Docker secret file is skipped (falls through to OC)', () => {
    const dockerDir = path.join(tmp.dir, 'empty-file-docker');
    const ocDir = path.join(tmp.dir, 'oc-secrets-3');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });
    fs.writeFileSync(path.join(dockerDir, 'llm_api_key'), '');  // empty
    fs.writeFileSync(path.join(ocDir, 'llm_api_key'), 'oc-key');

    assert.equal(readSecret('llm_api_key', dockerDir, ocDir, ''), 'oc-key');
  });

  test('empty OC secret file is skipped (falls through to env)', () => {
    const dockerDir = path.join(tmp.dir, 'no-docker-2');
    const ocDir = path.join(tmp.dir, 'empty-oc');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });
    fs.writeFileSync(path.join(ocDir, 'gateway_token'), '');

    assert.equal(readSecret('gateway_token', dockerDir, ocDir, 'env-gw'), 'env-gw');
  });

  test('returns empty string when nothing available', () => {
    const dockerDir = path.join(tmp.dir, 'none1');
    const ocDir = path.join(tmp.dir, 'none2');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });

    assert.equal(readSecret('missing_secret', dockerDir, ocDir, ''), '');
  });

  test('works for all known secret names', () => {
    const secrets = ['gateway_token', 'llm_api_key', 'telegram_bot_token', 'groq_api_key', 'brave_api_key'];
    const dockerDir = path.join(tmp.dir, 'all-secrets');
    const ocDir = path.join(tmp.dir, 'all-oc');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(ocDir, { recursive: true });

    for (const name of secrets) {
      fs.writeFileSync(path.join(dockerDir, name), `docker-${name}`);
      fs.writeFileSync(path.join(ocDir, name), `oc-${name}`);
    }

    for (const name of secrets) {
      assert.equal(readSecret(name, dockerDir, ocDir, `env-${name}`), `docker-${name}`,
        `Docker secret should win for ${name}`);
    }
  });
});

// ── 3. Workspace bootstrapping ──────────────────────────────────────────────

describe('Workspace bootstrapping', () => {
  let tmp;

  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  /**
   * Simulate entrypoint workspace bootstrap logic:
   * - System files: always overwrite
   * - User files (non-template): seed only on first run
   * - USER.md: generated from template via envsubst
   */
  function bootstrapWorkspace(imageSystemDir, imageTemplatesDir, ocWorkspace, env) {
    fs.mkdirSync(ocWorkspace, { recursive: true });

    // System files: copy from image on every boot (overwrite)
    if (fs.existsSync(imageSystemDir)) {
      for (const f of fs.readdirSync(imageSystemDir)) {
        if (f.endsWith('.md')) {
          fs.copyFileSync(path.join(imageSystemDir, f), path.join(ocWorkspace, f));
        }
      }
    }

    // User files: seed only on first run (skip USER.md.template)
    if (fs.existsSync(imageTemplatesDir)) {
      for (const f of fs.readdirSync(imageTemplatesDir)) {
        if (!f.endsWith('.md')) continue;
        if (f === 'USER.md.template') continue;
        const target = path.join(ocWorkspace, f);
        if (!fs.existsSync(target)) {
          fs.copyFileSync(path.join(imageTemplatesDir, f), target);
        }
      }
    }

    // USER.md migration: regenerate if stale template syntax detected
    const userMdPath = path.join(ocWorkspace, 'USER.md');
    if (fs.existsSync(userMdPath)) {
      const content = fs.readFileSync(userMdPath, 'utf8');
      if (content.includes('${')) {
        fs.unlinkSync(userMdPath);
      }
    }

    // USER.md: generate from template via envsubst on first run
    if (!fs.existsSync(userMdPath)) {
      const templatePath = path.join(imageTemplatesDir, 'USER.md.template');
      if (fs.existsSync(templatePath)) {
        const template = fs.readFileSync(templatePath, 'utf8');
        const vars = ['USER_NAME', 'USER_TIMEZONE', 'USER_LANGUAGE', 'USER_CONTEXT'];
        const rendered = envsubst(template, env, vars);
        fs.writeFileSync(userMdPath, rendered);
      }
    }
  }

  test('system files are overwritten on every boot', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys');
    const imageTemplates = path.join(tmp.dir, 'img-tpl');
    const workspace = path.join(tmp.dir, 'ws1');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    // "Image" has AGENTS.md v2
    fs.writeFileSync(path.join(imageSystem, 'AGENTS.md'), 'v2 content');
    // Workspace has old AGENTS.md
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'v1 old content');

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, {});

    assert.equal(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), 'v2 content');
  });

  test('user files seeded only on first run (no overwrite)', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys2');
    const imageTemplates = path.join(tmp.dir, 'img-tpl2');
    const workspace = path.join(tmp.dir, 'ws2');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    fs.writeFileSync(path.join(imageTemplates, 'NOTES.md'), 'template notes');

    // First run: file gets seeded
    bootstrapWorkspace(imageSystem, imageTemplates, workspace, {});
    assert.equal(fs.readFileSync(path.join(workspace, 'NOTES.md'), 'utf8'), 'template notes');

    // User modifies the file
    fs.writeFileSync(path.join(workspace, 'NOTES.md'), 'my custom notes');

    // Second boot: file not overwritten
    bootstrapWorkspace(imageSystem, imageTemplates, workspace, {});
    assert.equal(fs.readFileSync(path.join(workspace, 'NOTES.md'), 'utf8'), 'my custom notes');
  });

  test('USER.md generated from template with envsubst', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys3');
    const imageTemplates = path.join(tmp.dir, 'img-tpl3');
    const workspace = path.join(tmp.dir, 'ws3');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    // Use the real template
    fs.copyFileSync(USER_TEMPLATE_PATH, path.join(imageTemplates, 'USER.md.template'));

    const env = {
      USER_NAME: 'Tomas',
      USER_TIMEZONE: 'America/Argentina/Buenos_Aires',
      USER_LANGUAGE: 'Spanish',
      USER_CONTEXT: 'Senior dev working on AI projects.',
    };

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, env);
    const userMd = fs.readFileSync(path.join(workspace, 'USER.md'), 'utf8');

    assert.ok(userMd.includes('Tomas'));
    assert.ok(userMd.includes('America/Argentina/Buenos_Aires'));
    assert.ok(userMd.includes('Spanish'));
    assert.ok(userMd.includes('Senior dev working on AI projects.'));
    // No unexpanded variables
    assert.ok(!userMd.includes('$USER_NAME'));
    assert.ok(!userMd.includes('${USER_NAME}'));
  });

  test('USER.md regenerated if it contains unexpanded ${...} syntax', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys4');
    const imageTemplates = path.join(tmp.dir, 'img-tpl4');
    const workspace = path.join(tmp.dir, 'ws4');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    fs.copyFileSync(USER_TEMPLATE_PATH, path.join(imageTemplates, 'USER.md.template'));

    // Simulate a stale USER.md with unexpanded syntax (issue #243)
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'USER.md'), '# About\n- Name: ${USER_NAME}\n');

    const env = {
      USER_NAME: 'Tomas',
      USER_TIMEZONE: 'UTC',
      USER_LANGUAGE: 'English',
      USER_CONTEXT: 'No additional context provided.',
    };

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, env);
    const userMd = fs.readFileSync(path.join(workspace, 'USER.md'), 'utf8');

    assert.ok(userMd.includes('Tomas'), 'USER.md should have been regenerated with the env value');
    assert.ok(!userMd.includes('${USER_NAME}'), 'No unexpanded syntax should remain');
  });

  test('USER.md not regenerated if no stale syntax', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys5');
    const imageTemplates = path.join(tmp.dir, 'img-tpl5');
    const workspace = path.join(tmp.dir, 'ws5');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    fs.copyFileSync(USER_TEMPLATE_PATH, path.join(imageTemplates, 'USER.md.template'));
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'USER.md'), '# Custom USER.md\nHand-edited by user.\n');

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, { USER_NAME: 'Override' });
    const userMd = fs.readFileSync(path.join(workspace, 'USER.md'), 'utf8');

    assert.ok(userMd.includes('Hand-edited by user'), 'Should preserve user edits');
    assert.ok(!userMd.includes('Override'), 'Should NOT regenerate when no stale syntax');
  });

  test('USER.md.template is not seeded as a user file', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys6');
    const imageTemplates = path.join(tmp.dir, 'img-tpl6');
    const workspace = path.join(tmp.dir, 'ws6');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    fs.writeFileSync(path.join(imageTemplates, 'USER.md.template'), 'template');
    fs.writeFileSync(path.join(imageTemplates, 'OTHER.md'), 'other file');

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, {});

    assert.ok(!fs.existsSync(path.join(workspace, 'USER.md.template')),
      'USER.md.template should not be copied to workspace');
    assert.ok(fs.existsSync(path.join(workspace, 'OTHER.md')),
      'OTHER.md should be seeded');
  });

  test('USER.md defaults when env vars are empty', () => {
    const imageSystem = path.join(tmp.dir, 'img-sys7');
    const imageTemplates = path.join(tmp.dir, 'img-tpl7');
    const workspace = path.join(tmp.dir, 'ws7');
    fs.mkdirSync(imageSystem, { recursive: true });
    fs.mkdirSync(imageTemplates, { recursive: true });

    fs.copyFileSync(USER_TEMPLATE_PATH, path.join(imageTemplates, 'USER.md.template'));

    // Simulate entrypoint defaults
    const env = {
      USER_NAME: 'User',
      USER_TIMEZONE: '',
      USER_LANGUAGE: 'English',
      USER_CONTEXT: 'No additional context provided.',
    };

    bootstrapWorkspace(imageSystem, imageTemplates, workspace, env);
    const userMd = fs.readFileSync(path.join(workspace, 'USER.md'), 'utf8');

    assert.ok(userMd.includes('User'));
    assert.ok(userMd.includes('English'));
    // Valid content, no crashes
    assert.ok(userMd.length > 50);
  });
});

// ── 4. Provider/model remapping ─────────────────────────────────────────────

describe('Provider/model remapping', () => {
  /**
   * Replicates the entrypoint.sh subscription-mode remapping logic.
   * Returns { modelProvider, envExports } where envExports is a map of
   * env vars that would be exported.
   */
  function resolveProvider(authMode, modelProvider, llmApiKey) {
    const envExports = {};
    let provider = modelProvider;

    if (authMode === 'subscription') {
      // Subscription + openai -> openai-codex
      if (modelProvider === 'openai') {
        provider = 'openai-codex';
      }

      // Export key based on provider
      if (modelProvider === 'anthropic' || provider === 'anthropic') {
        if (llmApiKey) {
          if (llmApiKey.startsWith('sk-ant-oat')) {
            envExports.ANTHROPIC_OAUTH_TOKEN = llmApiKey;
          } else {
            envExports.ANTHROPIC_API_KEY = llmApiKey;
          }
        }
      } else if (provider === 'openai-codex' || modelProvider === 'openai') {
        if (llmApiKey) {
          envExports.OPENAI_API_KEY = llmApiKey;
        }
      }
    } else {
      // API-key mode
      switch (modelProvider) {
        case 'openrouter':
          if (llmApiKey) envExports.OPENROUTER_API_KEY = llmApiKey;
          break;
        case 'openai':
          if (llmApiKey) envExports.OPENAI_API_KEY = llmApiKey;
          break;
        default: // anthropic
          if (llmApiKey) envExports.ANTHROPIC_API_KEY = llmApiKey;
          break;
      }
    }

    return { modelProvider: provider, envExports };
  }

  test('subscription + openai remaps to openai-codex', () => {
    const result = resolveProvider('subscription', 'openai', 'sk-test-key');
    assert.equal(result.modelProvider, 'openai-codex');
    assert.equal(result.envExports.OPENAI_API_KEY, 'sk-test-key');
  });

  test('subscription + anthropic stays anthropic', () => {
    const result = resolveProvider('subscription', 'anthropic', 'sk-ant-api-key');
    assert.equal(result.modelProvider, 'anthropic');
    assert.equal(result.envExports.ANTHROPIC_API_KEY, 'sk-ant-api-key');
  });

  test('subscription + anthropic OAuth token (sk-ant-oat*) exports ANTHROPIC_OAUTH_TOKEN', () => {
    const result = resolveProvider('subscription', 'anthropic', 'sk-ant-oat-abc123');
    assert.equal(result.modelProvider, 'anthropic');
    assert.equal(result.envExports.ANTHROPIC_OAUTH_TOKEN, 'sk-ant-oat-abc123');
    assert.equal(result.envExports.ANTHROPIC_API_KEY, undefined);
  });

  test('subscription + anthropic non-OAuth key exports ANTHROPIC_API_KEY', () => {
    const result = resolveProvider('subscription', 'anthropic', 'sk-ant-regular-key');
    assert.equal(result.modelProvider, 'anthropic');
    assert.equal(result.envExports.ANTHROPIC_API_KEY, 'sk-ant-regular-key');
    assert.equal(result.envExports.ANTHROPIC_OAUTH_TOKEN, undefined);
  });

  test('subscription + anthropic with no key exports nothing', () => {
    const result = resolveProvider('subscription', 'anthropic', '');
    assert.equal(result.modelProvider, 'anthropic');
    assert.deepEqual(result.envExports, {});
  });

  test('api-key + openai exports OPENAI_API_KEY', () => {
    const result = resolveProvider('api-key', 'openai', 'sk-openai-123');
    assert.equal(result.modelProvider, 'openai');
    assert.equal(result.envExports.OPENAI_API_KEY, 'sk-openai-123');
  });

  test('api-key + openai does NOT remap to openai-codex', () => {
    const result = resolveProvider('api-key', 'openai', 'sk-openai-123');
    assert.equal(result.modelProvider, 'openai');
  });

  test('api-key + openrouter exports OPENROUTER_API_KEY', () => {
    const result = resolveProvider('api-key', 'openrouter', 'sk-or-v1-abc');
    assert.equal(result.modelProvider, 'openrouter');
    assert.equal(result.envExports.OPENROUTER_API_KEY, 'sk-or-v1-abc');
  });

  test('api-key + anthropic exports ANTHROPIC_API_KEY', () => {
    const result = resolveProvider('api-key', 'anthropic', 'sk-ant-abc');
    assert.equal(result.modelProvider, 'anthropic');
    assert.equal(result.envExports.ANTHROPIC_API_KEY, 'sk-ant-abc');
  });

  test('api-key + unknown provider defaults to anthropic behavior', () => {
    const result = resolveProvider('api-key', 'mistral', 'key-123');
    assert.equal(result.modelProvider, 'mistral');
    assert.equal(result.envExports.ANTHROPIC_API_KEY, 'key-123');
  });
});

// ── 5. Full pipeline integration (template -> envsubst -> injections) ───────

describe('Full config pipeline integration', () => {
  let tmp;

  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  const GATEWAY_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.gateway.auth.token = process.env.GATEWAY_TOKEN || '';
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;
  const TELEGRAM_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.channels = cfg.channels || {};
    cfg.channels.telegram = { enabled: true, botToken: process.env.TELEGRAM_BOT_TOKEN, allowFrom: ['*'] };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;
  const WEB_SEARCH_SCRIPT = `
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.tools = cfg.tools || {};
    cfg.tools.web = cfg.tools.web || {};
    cfg.tools.web.search = { enabled: true, provider: 'brave', maxResults: 5 };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  `;

  test('end-to-end: template -> envsubst -> all injections -> valid config', () => {
    const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const CONFIG_VARS = ['MODEL_PROVIDER', 'MODEL_NAME', 'LIMBO_PORT', 'RUNTIME_REASONING_EFFORT', 'OPENCLAW_STATE_DIR'];

    const env = {
      MODEL_PROVIDER: 'anthropic',
      MODEL_NAME: 'claude-opus-4-6',
      LIMBO_PORT: '18789',
      RUNTIME_REASONING_EFFORT: 'medium',
      OPENCLAW_STATE_DIR: '/home/limbo/.openclaw',
    };

    // Step 1: envsubst
    const rendered = envsubst(TEMPLATE, env, CONFIG_VARS);
    const cfgPath = path.join(tmp.dir, 'integration.json');
    fs.writeFileSync(cfgPath, rendered);

    // Verify JSON valid after envsubst
    JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    // Step 2-4: config injections (voice uses env var only)
    runNodeInject(GATEWAY_SCRIPT, cfgPath, { GATEWAY_TOKEN: 'gw-secret' });
    runNodeInject(TELEGRAM_SCRIPT, cfgPath, { TELEGRAM_BOT_TOKEN: '123:ABC' });
    runNodeInject(WEB_SEARCH_SCRIPT, cfgPath, { BRAVE_API_KEY: 'BSA_test' });

    // Final verification
    const final = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    // Model
    assert.equal(final.agents.defaults.model.primary, 'anthropic/claude-opus-4-6');
    assert.equal(final.agents.defaults.thinkingDefault, 'medium');

    // Gateway
    assert.equal(final.gateway.port, 18789);
    assert.equal(final.gateway.auth.token, 'gw-secret');

    // Telegram
    assert.equal(final.channels.telegram.enabled, true);
    assert.equal(final.channels.telegram.botToken, '123:ABC');

    // Voice: no config key — GROQ_API_KEY is env-only
    assert.ok(!final.transcription, 'No top-level transcription');

    // Web search: under tools.web.search
    assert.equal(final.tools.web.search.enabled, true);
    assert.ok(!final.webSearch, 'No top-level webSearch');

    // MCP server
    assert.equal(final.mcp.servers['limbo-vault'].command, 'node');

    // Cron
    assert.equal(final.cron.enabled, true);

    // Tools
    assert.equal(final.tools.profile, 'full');
  });
});

// ─── Auth-profiles migration (ZeroClaw → OpenClaw format) ──────────────────

describe('auth-profiles migration', () => {
  // Extract the inline node -e script from entrypoint.sh
  const ENTRYPOINT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'entrypoint.sh'), 'utf8');

  // The script is between: node -e "\n ... \n  " "$LEGACY_AUTH" "$AGENT_AUTH"
  const startMarker = 'LEGACY_AUTH" ] && [ ! -f "$AGENT_AUTH" ]; then\n  node -e "';
  const endMarker = '" "$LEGACY_AUTH" "$AGENT_AUTH"';
  const startIdx = ENTRYPOINT.indexOf(startMarker);
  const scriptStart = startIdx >= 0 ? startIdx + startMarker.length : -1;
  const scriptEnd = startIdx >= 0 ? ENTRYPOINT.indexOf(endMarker, scriptStart) : -1;
  const migrationScript = scriptStart >= 0 && scriptEnd >= 0
    ? ENTRYPOINT.slice(scriptStart, scriptEnd)
    : null;

  test('entrypoint has auth-profiles migration script', () => {
    assert.ok(migrationScript, 'Migration node -e script must exist in entrypoint.sh');
  });

  test('converts ZeroClaw format to OpenClaw format', () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      const legacyPath = path.join(dir, 'legacy.json');
      const outputPath = path.join(dir, 'output.json');

      const zeroclaw = {
        schema_version: 1,
        active_profiles: { 'openai-codex': 'openai-codex:default' },
        profiles: {
          'openai-codex:default': {
            provider: 'openai-codex',
            profile_name: 'default',
            kind: 'oauth',
            account_id: 'test-account-123',
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_at: '2026-12-01T00:00:00.000Z',
          },
        },
      };

      fs.writeFileSync(legacyPath, JSON.stringify(zeroclaw));
      execFileSync('node', ['-e', migrationScript, legacyPath, outputPath]);

      const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

      // OpenClaw format
      assert.equal(result.version, 1, 'Must have version: 1');
      assert.ok(!result.schema_version, 'Must not have schema_version');
      assert.ok(!result.active_profiles, 'Must not have active_profiles');

      const profile = result.profiles['openai-codex:default'];
      assert.ok(profile, 'Profile must exist');
      assert.equal(profile.type, 'oauth', 'kind → type');
      assert.equal(profile.access, 'test-access-token', 'access_token → access');
      assert.equal(profile.refresh, 'test-refresh-token', 'refresh_token → refresh');
      assert.equal(profile.accountId, 'test-account-123', 'account_id → accountId');
      assert.ok(!profile.access_token, 'Must not have access_token');
      assert.ok(!profile.refresh_token, 'Must not have refresh_token');
      assert.ok(!profile.kind, 'Must not have kind');
    } finally {
      cleanup();
    }
  });

  test('passes through already-OpenClaw format unchanged', () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      const legacyPath = path.join(dir, 'legacy.json');
      const outputPath = path.join(dir, 'output.json');

      const openclaw = {
        version: 1,
        profiles: {
          'openai-codex:default': {
            type: 'oauth',
            provider: 'openai-codex',
            access: 'already-correct',
            refresh: 'already-correct-refresh',
            expires: 1764547200000,
          },
        },
      };

      fs.writeFileSync(legacyPath, JSON.stringify(openclaw));
      execFileSync('node', ['-e', migrationScript, legacyPath, outputPath]);

      const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      assert.equal(result.version, 1);
      assert.equal(result.profiles['openai-codex:default'].access, 'already-correct');
    } finally {
      cleanup();
    }
  });
});
