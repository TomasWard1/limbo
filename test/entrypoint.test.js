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
 * Source /data/config/.env the way entrypoint.sh does (via `set -a; . file;`)
 * and return the resulting environment as a plain object. We run a tiny
 * shell snippet so we exercise the actual `sh` parsing rules (quoting,
 * escapes), which is what the entrypoint relies on.
 */
function sourceEnvFile(envPath) {
  const out = execFileSync('sh', ['-c',
    `set -a; . "${envPath}"; set +a; env`,
  ], { encoding: 'utf8' });
  const result = {};
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) result[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return result;
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

// ── 2. Token resolution via .env sourcing ─────────────────────────────────
// After the secrets-consolidation refactor the entrypoint sources all tokens
// from /data/config/.env — there is no more priority chain between
// /run/secrets, openclaw-state/secrets, and env vars.

describe('Token resolution via .env sourcing', () => {
  let tmp;

  before(() => { tmp = makeTmpDir(); });
  after(() => { tmp.cleanup(); });

  function writeEnv(filename, lines) {
    const fp = path.join(tmp.dir, filename);
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    return fp;
  }

  test('sourcing .env exposes every token as a shell variable', () => {
    const envFile = writeEnv('tokens.env', [
      'LLM_API_KEY="sk-ant-example"',
      'TELEGRAM_BOT_TOKEN="bot-tok"',
      'GROQ_API_KEY="gsk-tok"',
      'BRAVE_API_KEY="BSA-tok"',
      'GATEWAY_TOKEN="gw-tok"',
    ]);
    const sourced = sourceEnvFile(envFile);
    assert.equal(sourced.LLM_API_KEY, 'sk-ant-example');
    assert.equal(sourced.TELEGRAM_BOT_TOKEN, 'bot-tok');
    assert.equal(sourced.GROQ_API_KEY, 'gsk-tok');
    assert.equal(sourced.BRAVE_API_KEY, 'BSA-tok');
    assert.equal(sourced.GATEWAY_TOKEN, 'gw-tok');
  });

  test('sourcing a missing key leaves the variable unset', () => {
    const envFile = writeEnv('partial.env', [
      'LLM_API_KEY="only-llm"',
    ]);
    const sourced = sourceEnvFile(envFile);
    assert.equal(sourced.LLM_API_KEY, 'only-llm');
    assert.ok(!('TELEGRAM_BOT_TOKEN' in sourced));
  });

  test('entrypoint.sh sources tokens before running anything else', () => {
    // The refactor moved `. /data/config/.env` to the top of the script,
    // right after the logging helpers. This guards against future drift.
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'entrypoint.sh'),
      'utf8'
    );
    // The entrypoint uses eval+grep to safely source only valid KEY=VALUE lines.
    const sourceLine = entrypoint.indexOf("eval \"$(grep");
    assert.ok(sourceLine !== -1, 'entrypoint must source /data/config/.env (via eval+grep)');
    // The source line must come before any reference to LLM_API_KEY / GROQ_API_KEY
    const firstUsage = Math.min(
      entrypoint.indexOf('LLM_API_KEY='),
      entrypoint.indexOf('GROQ_API_KEY='),
      entrypoint.indexOf('BRAVE_API_KEY=')
    );
    assert.ok(
      sourceLine < firstUsage,
      '.env must be sourced before tokens are consumed'
    );
  });

  test('SETUP_MODE detection re-reads the file, not the in-memory var', () => {
    // The .env is sourced at the top of the script, so $MODEL_PROVIDER may
    // already be in shell memory by the time we check setup mode. If
    // SWITCH_BRAIN_MODE stripped it from the file, an in-memory check would
    // miss the strip and skip wizard mode. Guard: detection must grep the
    // file, not test the variable.
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'entrypoint.sh'),
      'utf8'
    );
    assert.ok(
      /grep -q '\^MODEL_PROVIDER=' \/data\/config\/\.env/.test(entrypoint),
      'SETUP_MODE detection must grep MODEL_PROVIDER from /data/config/.env'
    );
    // And it must NOT use the in-memory shortcut for the same check.
    assert.ok(
      !/elif \[ -z "\$\{MODEL_PROVIDER:-\}" \]/.test(entrypoint),
      'SETUP_MODE detection must not test the in-memory $MODEL_PROVIDER'
    );
  });

  test('.env is sourced before SWITCH_BRAIN_MODE strips MODEL_PROVIDER', () => {
    // Documents the invariant: tokens are loaded once at the top, then
    // SWITCH_BRAIN_MODE may rewrite the file. Detection must trust the file
    // afterwards (covered by the test above).
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'entrypoint.sh'),
      'utf8'
    );
    const sourceLine = entrypoint.indexOf("eval \"$(grep");
    const switchBrainStrip = entrypoint.indexOf("'/^MODEL_PROVIDER=/d'");
    assert.ok(sourceLine !== -1, 'entrypoint must source /data/config/.env (via eval+grep)');
    assert.ok(switchBrainStrip !== -1, 'SWITCH_BRAIN must strip MODEL_PROVIDER from .env');
    assert.ok(
      sourceLine < switchBrainStrip,
      '.env must be sourced before SWITCH_BRAIN strips MODEL_PROVIDER'
    );
  });

  test('entrypoint.sh no longer defines read_secret', () => {
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'entrypoint.sh'),
      'utf8'
    );
    assert.ok(
      !/read_secret\s*\(\s*\)/.test(entrypoint),
      'read_secret function must be removed from entrypoint'
    );
    // /run/secrets/ is now referenced only in the legacy migration block
    // that copies Docker secrets into .env on upgrade. The read_secret()
    // helper that used to be the primary token-resolution path is gone.
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
