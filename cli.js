#!/usr/bin/env node
// cli.js — Limbo CLI
// Orchestrates the Docker-based Limbo runtime.
'use strict';

const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// ─── Config ──────────────────────────────────────────────────────────────────

const LIMBO_DIR = path.join(os.homedir(), '.limbo');
const VAULT_DIR = path.join(LIMBO_DIR, 'vault');
const ENV_FILE = path.join(LIMBO_DIR, '.env');
const COMPOSE_FILE = path.join(LIMBO_DIR, 'docker-compose.yml');
const GHCR_IMAGE = 'ghcr.io/tomasward1/limbo';
const DEFAULT_TAG = require('./package.json').version;
const PORT = 18789;

// OpenClaw compatibility snapshots from official docs:
// - https://docs.openclaw.ai/providers/openai
// - https://docs.openclaw.ai/providers/anthropic
// - https://docs.openclaw.ai/start/wizard-cli-reference
const MODEL_CATALOG = {
  'openai:subscription': {
    provider: 'openai-codex',
    defaultModel: 'gpt-5.4',
    menuModels: ['gpt-5.4'],
    supportedModels: ['gpt-5.4', 'gpt-5.3-codex'],
  },
  'openai:api-key': {
    provider: 'openai',
    defaultModel: 'gpt-5.4',
    menuModels: ['gpt-5.4', 'gpt-5.4-pro'],
    supportedModels: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.1-codex'],
  },
  'anthropic:subscription': {
    provider: 'anthropic',
    defaultModel: 'claude-opus-4-6',
    menuModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    supportedModels: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1', 'claude-sonnet-4'],
  },
  'anthropic:api-key': {
    provider: 'anthropic',
    defaultModel: 'claude-opus-4-6',
    menuModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    supportedModels: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1', 'claude-sonnet-4'],
  },
};

const ASCII_ART = String.raw`
 _     ___ __  __ ____   ___
| |   |_ _|  \/  | __ ) / _ \
| |    | || |\/| |  _ \| | | |
| |___ | || |  | | |_) | |_| |
|_____|___|_|  |_|____/ \___/
`;

// docker-compose.yml written to ~/.limbo on install
const COMPOSE_CONTENT = `services:
  limbo:
    image: ${GHCR_IMAGE}:${DEFAULT_TAG}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
      - ./vault:/data/vault
      - limbo-openclaw-state:/home/limbo/.openclaw
    env_file:
      - .env
    environment:
      OPENCLAW_CONFIG_PATH: /home/limbo/.openclaw/openclaw.json
      OPENCLAW_STATE_DIR: /home/limbo/.openclaw
    healthcheck:
      test:
        - CMD-SHELL
        - >-
          node -e "const s=require('net').connect(${PORT},'127.0.0.1');const
          done=(c)=>{try{s.destroy()}catch{};process.exit(c)};s.on('connect',()=>done(0));s.on('error',()=>done(1));setTimeout(()=>done(1),2000);"
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

volumes:
  limbo-data:
  limbo-openclaw-state:
`;

const TEXT = {
  en: {
    languageName: 'English',
    chooseLanguage: 'Choose your language',
    menuHelp: 'Use arrow keys and press Enter.',
    providerQuestion: 'AI Provider',
    providerOpenAI: 'Codex (OpenAI)',
    providerAnthropic: 'Claude (Anthropic)',
    accessMethodQuestion: 'Access method',
    accessSubscriptionOpenAI: 'ChatGPT / Codex subscription',
    accessSubscriptionAnthropic: 'Claude Code subscription',
    accessApiKey: 'API token',
    modelQuestion: 'Model',
    customModel: 'Add another supported model name',
    customModelPrompt: '  Model name: ',
    invalidModel: 'That model is not in the current OpenClaw docs allowlist for this provider/auth path.',
    supportedModels: 'Supported models:',
    openAiApiKeyPrompt: '  OpenAI API key (sk-...): ',
    anthropicApiKeyPrompt: '  Anthropic API key (sk-ant-...): ',
    requiredField: 'This field is required.',
    invalidOpenAIKey: 'OpenAI API keys usually start with "sk-".',
    invalidAnthropicKey: 'Anthropic API keys usually start with "sk-ant-".',
    telegramQuestion: 'Want to speak to Limbo through Telegram?',
    telegramTokenPrompt: '  Telegram bot token: ',
    yes: 'Yes',
    no: 'No',
    configuration: 'Configuration',
    reconfiguration: 'Reconfiguration',
    foundExistingConfig: `Found existing config at ${ENV_FILE}`,
    reconfigureHint: 'Starting with existing config. Use --reconfigure to change settings.',
    envWritten: '.env written.',
    pullingImage: 'Pulling image...',
    imagePulled: 'Image pulled.',
    pullFailed: 'Could not pull from GHCR. Trying local build fallback...',
    buildingFallback: 'Building from local Dockerfile...',
    buildOk: (tag) => `Built: ${GHCR_IMAGE}:${tag}`,
    starting: 'Starting Limbo...',
    verifying: 'Verifying health...',
    waitingHealth: (i, max) => `Waiting for container to be healthy... (${i}/${max})`,
    healthTimeout: 'Container did not report healthy within timeout.',
    logsHint: 'Check logs with: limbo logs',
    healthy: 'Container is healthy.',
    subscriptionSetup: 'Provider authentication',
    openaiSubscriptionIntro: 'Limbo will open OpenClaw auth inside the container so you can complete Codex login.',
    anthropicSubscriptionIntro: 'Generate a Claude setup-token on any machine with `claude setup-token`, then paste it into the next step.',
    authFlowStart: 'Starting provider auth flow...',
    authFlowDone: 'Provider auth completed.',
    authFlowFailed: 'Provider auth did not complete successfully.',
    authStatusFailed: 'OpenClaw still reports missing or invalid auth for the selected provider.',
    configFlowStart: 'Applying OpenClaw config...',
    configFlowDone: 'OpenClaw config updated.',
    configFlowFailed: 'Could not update the OpenClaw config for Limbo.',
    success: 'Limbo is running!',
    gateway: 'Gateway',
    gatewayToken: 'Gateway token',
    data: 'Data',
    logs: 'Logs',
    stop: 'Stop',
    update: 'Update',
    telegramEnabledHint: 'Telegram is enabled. Message your bot to start talking to Limbo.',
    nonTelegramHintTitle: 'No Telegram? You can still talk to Limbo through another agent.',
    nonTelegramPromptIntro: 'Suggested prompt:',
    nonTelegramPrompt: (token) => `Connect to my Limbo gateway at ws://127.0.0.1:${PORT} using token ${token}. Use Limbo as my memory layer: save notes, recall context, and update maps of content when I ask.`,
    dockerMissing: 'Docker is not installed or `docker compose` is unavailable.\nInstall Docker Desktop: https://docs.docker.com/get-docker/',
    installMissing: 'Limbo is not installed. Run: npx limbo start',
    helpTitle: 'limbo - personal AI memory agent',
    usage: 'Usage',
    commands: 'Commands',
    flags: 'Flags',
    dataDirectory: 'Data directory',
    helpStart: 'Install and start Limbo (default if no command given)',
    helpStop: 'Stop the running container',
    helpLogs: 'Tail container logs',
    helpUpdate: 'Pull latest image and restart',
    helpStatus: 'Show container status',
    helpHelp: 'Show this help',
    helpReconfigure: 'Reconfigure auth and onboarding settings (use with start)',
    unknownCommand: (cmd) => `Unknown command: ${cmd}`,
  },
  es: {
    languageName: 'Espanol',
    chooseLanguage: 'Elige tu idioma',
    menuHelp: 'Usa las flechas y Enter.',
    providerQuestion: 'AI Provider',
    providerOpenAI: 'Codex (OpenAI)',
    providerAnthropic: 'Claude (Anthropic)',
    accessMethodQuestion: 'Metodo de acceso',
    accessSubscriptionOpenAI: 'Suscripcion ChatGPT / Codex',
    accessSubscriptionAnthropic: 'Suscripcion Claude Code',
    accessApiKey: 'API token',
    modelQuestion: 'Modelo',
    customModel: 'Agregar otro nombre de modelo soportado',
    customModelPrompt: '  Nombre del modelo: ',
    invalidModel: 'Ese modelo no esta en la allowlist actual de OpenClaw para este provider y metodo.',
    supportedModels: 'Modelos soportados:',
    openAiApiKeyPrompt: '  OpenAI API key (sk-...): ',
    anthropicApiKeyPrompt: '  Anthropic API key (sk-ant-...): ',
    requiredField: 'Este campo es obligatorio.',
    invalidOpenAIKey: 'Las API keys de OpenAI normalmente empiezan con "sk-".',
    invalidAnthropicKey: 'Las API keys de Anthropic normalmente empiezan con "sk-ant-".',
    telegramQuestion: 'Quieres hablar con Limbo por Telegram?',
    telegramTokenPrompt: '  Telegram bot token: ',
    yes: 'Si',
    no: 'No',
    configuration: 'Configuracion',
    reconfiguration: 'Reconfiguracion',
    foundExistingConfig: `Se encontro una configuracion existente en ${ENV_FILE}`,
    reconfigureHint: 'Se va a usar la configuracion actual. Usa --reconfigure para cambiarla.',
    envWritten: '.env escrito.',
    pullingImage: 'Bajando imagen...',
    imagePulled: 'Imagen descargada.',
    pullFailed: 'No se pudo bajar la imagen desde GHCR. Probando build local...',
    buildingFallback: 'Construyendo desde el Dockerfile local...',
    buildOk: (tag) => `Imagen construida: ${GHCR_IMAGE}:${tag}`,
    starting: 'Arrancando Limbo...',
    verifying: 'Verificando health...',
    waitingHealth: (i, max) => `Esperando a que el container quede healthy... (${i}/${max})`,
    healthTimeout: 'El container no reporto healthy dentro del timeout.',
    logsHint: 'Mira los logs con: limbo logs',
    healthy: 'El container esta healthy.',
    subscriptionSetup: 'Autenticacion del provider',
    openaiSubscriptionIntro: 'Limbo va a abrir la autenticacion de OpenClaw dentro del container para que completes el login de Codex.',
    anthropicSubscriptionIntro: 'Genera un Claude setup-token en cualquier maquina con `claude setup-token` y pegalo en el siguiente paso.',
    authFlowStart: 'Iniciando autenticacion del provider...',
    authFlowDone: 'Autenticacion del provider completada.',
    authFlowFailed: 'La autenticacion del provider no termino correctamente.',
    authStatusFailed: 'OpenClaw sigue reportando auth faltante o invalida para el provider elegido.',
    configFlowStart: 'Aplicando configuracion de OpenClaw...',
    configFlowDone: 'Configuracion de OpenClaw actualizada.',
    configFlowFailed: 'No se pudo actualizar la configuracion de OpenClaw para Limbo.',
    success: 'Limbo esta corriendo!',
    gateway: 'Gateway',
    gatewayToken: 'Token del gateway',
    data: 'Data',
    logs: 'Logs',
    stop: 'Stop',
    update: 'Update',
    telegramEnabledHint: 'Telegram esta habilitado. Escribile a tu bot para empezar a hablar con Limbo.',
    nonTelegramHintTitle: 'Sin Telegram? Igual puedes hablar con Limbo desde otro agente.',
    nonTelegramPromptIntro: 'Prompt sugerido:',
    nonTelegramPrompt: (token) => `Conectate a mi gateway de Limbo en ws://127.0.0.1:${PORT} usando el token ${token}. Usa Limbo como mi capa de memoria: guarda notas, recupera contexto y actualiza maps of content cuando yo lo pida.`,
    dockerMissing: 'Docker no esta instalado o `docker compose` no esta disponible.\nInstala Docker Desktop: https://docs.docker.com/get-docker/',
    installMissing: 'Limbo no esta instalado. Corre: npx limbo start',
    helpTitle: 'limbo - agente personal de memoria con AI',
    usage: 'Uso',
    commands: 'Comandos',
    flags: 'Flags',
    dataDirectory: 'Directorio de data',
    helpStart: 'Instala y arranca Limbo (default si no pasas comando)',
    helpStop: 'Frena el container',
    helpLogs: 'Sigue los logs del container',
    helpUpdate: 'Baja la ultima imagen y reinicia',
    helpStatus: 'Muestra el estado del container',
    helpHelp: 'Muestra esta ayuda',
    helpReconfigure: 'Reconfigura auth y onboarding (usar con start)',
    unknownCommand: (cmd) => `Comando desconocido: ${cmd}`,
  },
};

// ─── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

const log = (msg) => console.log(`${c.cyan}[limbo]${c.reset} ${msg}`);
const ok = (msg) => console.log(`${c.green}[limbo]${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}[limbo]${c.reset} ${msg}`);
const die = (msg) => { console.error(`${c.red}[limbo] ERROR:${c.reset} ${msg}`); process.exit(1); };
const header = (msg) => console.log(`\n${c.bold}${msg}${c.reset}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function t(lang, key, ...args) {
  const value = TEXT[lang][key];
  return typeof value === 'function' ? value(...args) : value;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let clackPromise;

async function getClack() {
  if (!clackPromise) clackPromise = import('@clack/prompts');
  return clackPromise;
}

async function maybeHandleClackCancel(value) {
  const { cancel, isCancel } = await getClack();
  if (isCancel(value)) {
    cancel('Setup cancelled.');
    process.exit(130);
  }
  return value;
}

function hasDocker() {
  const result = spawnSync('docker', ['compose', 'version'], { stdio: 'pipe' });
  return result.status === 0;
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: LIMBO_DIR, ...opts });
}

function runQuiet(cmd) {
  return execSync(cmd, { stdio: 'pipe', cwd: LIMBO_DIR }).toString().trim();
}

function runDockerCompose(args, opts = {}) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: LIMBO_DIR,
    stdio: opts.stdio || 'inherit',
    input: opts.input,
    encoding: opts.encoding || 'utf8',
  });

  if (result.error) throw result.error;
  return result;
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function createPromptInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function promptValidated(question, validate, errorMessage) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { text } = await getClack();
    while (true) {
      const value = await maybeHandleClackCancel(await text({
        message: question.trim(),
        validate: (input) => {
          const validation = validate(String(input ?? ''));
          return validation.ok ? undefined : (validation.message || errorMessage);
        },
      }));
      const validation = validate(String(value));
      if (validation.ok) return validation.value;
    }
  }

  const rl = createPromptInterface();
  while (true) {
    const value = (await prompt(rl, question)).trim();
    const validation = validate(value);
    if (validation.ok) {
      rl.close();
      return validation.value;
    }
    warn(validation.message || errorMessage);
  }
}

async function selectMenu(question, options, lang) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const rl = createPromptInterface();
    while (true) {
      console.log(`\n${question}`);
      options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
      const raw = (await prompt(rl, '  > ')).trim();
      const selected = Number(raw);
      if (Number.isInteger(selected) && selected >= 1 && selected <= options.length) {
        rl.close();
        return options[selected - 1];
      }
      warn('Pick one of the listed options.');
    }
  }
  const { select } = await getClack();
  const selectedValue = await maybeHandleClackCancel(await select({
    message: question,
    options: options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description,
    })),
  }));
  return options.find((option) => option.value === selectedValue) || options[0];
}

function parseEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return fs.readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      acc[line.slice(0, idx)] = line.slice(idx + 1);
      return acc;
    }, {});
}

function generateGatewayToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeConfig(cfg, existingEnv = {}) {
  const gatewayToken = cfg.gatewayToken || existingEnv.OPENCLAW_GATEWAY_TOKEN || generateGatewayToken();
  const base = {
    CLI_LANGUAGE: cfg.language || existingEnv.CLI_LANGUAGE || 'en',
    AUTH_MODE: cfg.authMode || existingEnv.AUTH_MODE || 'api-key',
    MODEL_PROVIDER: cfg.provider || existingEnv.MODEL_PROVIDER || 'anthropic',
    MODEL_NAME: cfg.modelName || existingEnv.MODEL_NAME || 'claude-opus-4-6',
    OPENAI_API_KEY: cfg.provider === 'openai' && cfg.apiKey ? cfg.apiKey : (cfg.keepExisting ? existingEnv.OPENAI_API_KEY || '' : ''),
    ANTHROPIC_API_KEY: cfg.provider === 'anthropic' && cfg.apiKey ? cfg.apiKey : (cfg.keepExisting ? existingEnv.ANTHROPIC_API_KEY || '' : ''),
    LLM_API_KEY: cfg.apiKey || (cfg.keepExisting ? existingEnv.LLM_API_KEY || '' : ''),
    TELEGRAM_ENABLED: cfg.telegramEnabled || existingEnv.TELEGRAM_ENABLED || 'false',
    TELEGRAM_BOT_TOKEN: cfg.telegramToken || (cfg.keepExisting ? existingEnv.TELEGRAM_BOT_TOKEN || '' : ''),
    TELEGRAM_AUTO_PAIR_FIRST_DM: existingEnv.TELEGRAM_AUTO_PAIR_FIRST_DM || 'true',
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };

  return base;
}

function writeEnv(cfg, existingEnv = {}) {
  const content = Object.entries(normalizeConfig(cfg, existingEnv))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
}

function waitForHealthy(lang, maxAttempts = 12) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const raw = runQuiet('docker compose ps --format json');
      if (raw.includes('"healthy"')) return true;
    } catch {}
    log(t(lang, 'waitingHealth', i, maxAttempts));
    sleep(5000);
  }
  return false;
}

function getModelCatalog(providerFamily, authMode) {
  return MODEL_CATALOG[`${providerFamily}:${authMode}`];
}

async function chooseModel(lang, providerFamily, authMode) {
  const catalog = getModelCatalog(providerFamily, authMode);
  const options = catalog.menuModels.map((model) => ({ label: model, value: model }));
  options.push({ label: t(lang, 'customModel'), value: '__custom__' });

  const selection = await selectMenu(t(lang, 'modelQuestion'), options, lang);
  if (selection.value !== '__custom__') return selection.value;

  const rl = createPromptInterface();
  while (true) {
    const modelName = (await prompt(rl, t(lang, 'customModelPrompt'))).trim();
    if (!modelName) {
      warn(t(lang, 'requiredField'));
      continue;
    }
    if (catalog.supportedModels.includes(modelName)) {
      rl.close();
      return modelName;
    }
    warn(t(lang, 'invalidModel'));
    console.log(`  ${t(lang, 'supportedModels')} ${catalog.supportedModels.join(', ')}`);
  }
}

async function collectConfig(existingEnv = {}) {
  console.log(`${c.cyan}${ASCII_ART}${c.reset}`);

  const language = (await selectMenu(t('en', 'chooseLanguage'), [
    { label: TEXT.en.languageName, value: 'en' },
    { label: TEXT.es.languageName, value: 'es' },
  ], 'en')).value;

  const providerFamily = (await selectMenu(t(language, 'providerQuestion'), [
    { label: t(language, 'providerOpenAI'), value: 'openai' },
    { label: t(language, 'providerAnthropic'), value: 'anthropic' },
  ], language)).value;

  const accessMethod = (await selectMenu(t(language, 'accessMethodQuestion'), [
    {
      label: providerFamily === 'openai'
        ? t(language, 'accessSubscriptionOpenAI')
        : t(language, 'accessSubscriptionAnthropic'),
      value: 'subscription',
    },
    { label: t(language, 'accessApiKey'), value: 'api-key' },
  ], language)).value;

  const modelName = await chooseModel(language, providerFamily, accessMethod);
  const provider = getModelCatalog(providerFamily, accessMethod).provider;
  let apiKey = '';

  if (accessMethod === 'api-key') {
    if (providerFamily === 'openai') {
      apiKey = await promptValidated(
        t(language, 'openAiApiKeyPrompt'),
        (value) => {
          if (!value) return { ok: false, message: t(language, 'requiredField') };
          if (!value.startsWith('sk-')) return { ok: false, message: t(language, 'invalidOpenAIKey') };
          return { ok: true, value };
        },
      );
    } else {
      apiKey = await promptValidated(
        t(language, 'anthropicApiKeyPrompt'),
        (value) => {
          if (!value) return { ok: false, message: t(language, 'requiredField') };
          if (!value.startsWith('sk-ant-')) return { ok: false, message: t(language, 'invalidAnthropicKey') };
          return { ok: true, value };
        },
      );
    }
  }

  const telegramChoice = await selectMenu(t(language, 'telegramQuestion'), [
    { label: t(language, 'yes'), value: 'true' },
    { label: t(language, 'no'), value: 'false' },
  ], language);

  let telegramToken = '';
  if (telegramChoice.value === 'true') {
    telegramToken = await promptValidated(
      t(language, 'telegramTokenPrompt'),
      (value) => value ? { ok: true, value } : { ok: false, message: t(language, 'requiredField') },
    );
  }

  return {
    language,
    authMode: accessMethod,
    provider,
    providerFamily,
    modelName,
    apiKey,
    telegramEnabled: telegramChoice.value,
    telegramToken,
    gatewayToken: existingEnv.OPENCLAW_GATEWAY_TOKEN || generateGatewayToken(),
  };
}

function ensureComposeFile() {
  fs.mkdirSync(LIMBO_DIR, { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'maps'), { recursive: true });
  fs.writeFileSync(COMPOSE_FILE, COMPOSE_CONTENT);
}

function ensureGatewayToken(existingEnv) {
  if (existingEnv.OPENCLAW_GATEWAY_TOKEN) return existingEnv.OPENCLAW_GATEWAY_TOKEN;
  writeEnv({ keepExisting: true }, existingEnv);
  return parseEnvFile().OPENCLAW_GATEWAY_TOKEN;
}

function pullOrBuildImage(lang) {
  header(t(lang, 'pullingImage'));
  try {
    run('docker compose pull -q');
    ok(t(lang, 'imagePulled'));
  } catch {
    warn(t(lang, 'pullFailed'));
    const repoDockerfile = path.join(__dirname, 'Dockerfile');
    if (!fs.existsSync(repoDockerfile)) {
      die('Could not pull image and no local Dockerfile found. Check your network or GHCR access.');
    }
    log(t(lang, 'buildingFallback'));
    execSync(`docker build -t ${GHCR_IMAGE}:${DEFAULT_TAG} .`, { stdio: 'inherit', cwd: __dirname });
    ok(t(lang, 'buildOk', DEFAULT_TAG));
  }
}

function runOpenClaw(args, opts = {}) {
  return runDockerCompose(['run', '--rm', '--entrypoint', 'openclaw', 'limbo', ...args], opts);
}

function applyOpenClawConfig(cfg) {
  header(t(cfg.language, 'configFlowStart'));

  const setCommands = [
    ['config', 'set', 'gateway.mode', 'local'],
    ['config', 'set', 'gateway.port', String(PORT), '--strict-json'],
    ['config', 'set', 'gateway.bind', 'loopback'],
    ['config', 'set', 'gateway.auth.mode', 'token'],
    ['config', 'set', 'agents.defaults.workspace', '/data/workspace'],
    ['config', 'set', 'agents.defaults.model.primary', `${cfg.provider}/${cfg.modelName}`],
  ];

  if (cfg.telegramEnabled === 'true') {
    setCommands.push(
      ['config', 'set', 'channels.telegram.enabled', 'true', '--strict-json'],
      ['config', 'set', 'channels.telegram.botToken', cfg.telegramToken],
    );
  }

  for (const command of setCommands) {
    const result = runOpenClaw(command, { stdio: 'pipe' });
    if (result.status !== 0) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      die(t(cfg.language, 'configFlowFailed'));
    }
  }

  if (cfg.telegramEnabled !== 'true') {
    runOpenClaw(['config', 'unset', 'channels.telegram'], { stdio: 'pipe' });
  }

  const validateResult = runOpenClaw(['config', 'validate'], { stdio: 'pipe' });
  if (validateResult.status !== 0) {
    process.stdout.write(validateResult.stdout || '');
    process.stderr.write(validateResult.stderr || '');
    die(t(cfg.language, 'configFlowFailed'));
  }

  ok(t(cfg.language, 'configFlowDone'));
}

function runSubscriptionAuthFlow(cfg) {
  header(t(cfg.language, 'subscriptionSetup'));
  if (cfg.providerFamily === 'openai') {
    log(t(cfg.language, 'openaiSubscriptionIntro'));
  } else {
    log(t(cfg.language, 'anthropicSubscriptionIntro'));
  }
  log(t(cfg.language, 'authFlowStart'));

  const authArgs = cfg.providerFamily === 'openai'
    ? ['models', 'auth', 'login', '--provider', 'openai-codex']
    : ['models', 'auth', 'paste-token', '--provider', 'anthropic'];

  const authResult = runOpenClaw(authArgs);
  if (authResult.status !== 0) die(t(cfg.language, 'authFlowFailed'));

  const statusResult = runOpenClaw(
    ['models', 'status', '--check', '--probe-provider', cfg.provider],
    { stdio: 'pipe' },
  );

  if (statusResult.status !== 0) {
    process.stdout.write(statusResult.stdout || '');
    process.stderr.write(statusResult.stderr || '');
    die(t(cfg.language, 'authStatusFailed'));
  }

  ok(t(cfg.language, 'authFlowDone'));
}

function printSuccess(cfg, gatewayToken) {
  console.log(`
${c.green}${c.bold}╔════════════════════════════════════════════╗${c.reset}
${c.green}${c.bold}║       ${t(cfg.language, 'success').padEnd(34, ' ')}║${c.reset}
${c.green}${c.bold}╚════════════════════════════════════════════╝${c.reset}

  ${c.bold}${t(cfg.language, 'gateway')}:${c.reset}        ws://127.0.0.1:${PORT}
  ${c.bold}${t(cfg.language, 'gatewayToken')}:${c.reset}  ${gatewayToken}
  ${c.bold}${t(cfg.language, 'data')}:${c.reset}           ${LIMBO_DIR}
  ${c.bold}Vault:${c.reset}          ${VAULT_DIR}
  ${c.bold}${t(cfg.language, 'logs')}:${c.reset}           limbo logs
  ${c.bold}${t(cfg.language, 'stop')}:${c.reset}           limbo stop
  ${c.bold}${t(cfg.language, 'update')}:${c.reset}         limbo update
`);

  if (cfg.telegramEnabled === 'true') {
    console.log(`  ${t(cfg.language, 'telegramEnabledHint')}`);
    return;
  }

  console.log(`  ${t(cfg.language, 'nonTelegramHintTitle')}`);
  console.log(`  ${t(cfg.language, 'nonTelegramPromptIntro')}`);
  console.log(`  "${t(cfg.language, 'nonTelegramPrompt', gatewayToken)}"`);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStart() {
  if (!hasDocker()) die(t('en', 'dockerMissing'));

  ensureComposeFile();

  const existingEnv = parseEnvFile();
  const alreadyHasEnv = fs.existsSync(ENV_FILE);
  let cfg;
  let lang = existingEnv.CLI_LANGUAGE || 'en';

  if (alreadyHasEnv) {
    log(existingEnv.MODEL_PROVIDER ? t(lang, 'foundExistingConfig') : `Found existing config at ${ENV_FILE}`);
    const reconfig = process.argv.includes('--reconfigure');
    if (!reconfig) {
      lang = existingEnv.CLI_LANGUAGE || 'en';
      log(t(lang, 'reconfigureHint'));
      ensureGatewayToken(existingEnv);
      cfg = {
        language: lang,
        provider: existingEnv.MODEL_PROVIDER || 'anthropic',
        providerFamily: (existingEnv.MODEL_PROVIDER || 'anthropic').startsWith('openai') ? 'openai' : 'anthropic',
        authMode: existingEnv.AUTH_MODE || 'api-key',
        modelName: existingEnv.MODEL_NAME || 'claude-opus-4-6',
        telegramEnabled: existingEnv.TELEGRAM_ENABLED || 'false',
      };
    } else {
      header(t(lang, 'reconfiguration'));
      cfg = await collectConfig(existingEnv);
      writeEnv({ ...cfg, CLI_LANGUAGE: cfg.language }, existingEnv);
      ok(t(cfg.language, 'envWritten'));
    }
  } else {
    header(t('en', 'configuration'));
    cfg = await collectConfig(existingEnv);
    writeEnv({ ...cfg, CLI_LANGUAGE: cfg.language }, existingEnv);
    ok(t(cfg.language, 'envWritten'));
  }

  const mergedEnv = parseEnvFile();
  if (!cfg.language) cfg.language = mergedEnv.CLI_LANGUAGE || 'en';
  if (!mergedEnv.CLI_LANGUAGE) {
    writeEnv({ ...cfg, keepExisting: true, CLI_LANGUAGE: cfg.language }, mergedEnv);
  }

  pullOrBuildImage(cfg.language);

  if (cfg.authMode === 'subscription' && (process.argv.includes('--reconfigure') || !alreadyHasEnv)) {
    runSubscriptionAuthFlow(cfg);
  }

  applyOpenClawConfig({
    ...cfg,
    telegramToken: mergedEnv.TELEGRAM_BOT_TOKEN || cfg.telegramToken || '',
    telegramEnabled: mergedEnv.TELEGRAM_ENABLED || cfg.telegramEnabled || 'false',
  });

  header(t(cfg.language, 'starting'));
  run('docker compose up -d --remove-orphans');

  header(t(cfg.language, 'verifying'));
  const healthy = waitForHealthy(cfg.language);
  if (!healthy) {
    warn(t(cfg.language, 'healthTimeout'));
    warn(t(cfg.language, 'logsHint'));
  } else {
    ok(t(cfg.language, 'healthy'));
  }

  printSuccess({
    language: cfg.language,
    telegramEnabled: mergedEnv.TELEGRAM_ENABLED || cfg.telegramEnabled || 'false',
  }, parseEnvFile().OPENCLAW_GATEWAY_TOKEN);
}

function cmdStop() {
  if (!fs.existsSync(COMPOSE_FILE)) die(t('en', 'installMissing'));
  log('Stopping Limbo...');
  run('docker compose down');
  ok('Stopped.');
}

function cmdLogs() {
  if (!fs.existsSync(COMPOSE_FILE)) die(t('en', 'installMissing'));
  run('docker compose logs -f');
}

function cmdUpdate() {
  if (!fs.existsSync(COMPOSE_FILE)) die(t('en', 'installMissing'));
  log('Pulling latest image...');
  run('docker compose pull -q');
  log('Restarting...');
  run('docker compose up -d --remove-orphans');
  ok('Updated and restarted.');
}

function cmdStatus() {
  if (!fs.existsSync(COMPOSE_FILE)) {
    log('Limbo is not installed.');
    return;
  }
  run('docker compose ps');
}

function cmdHelp() {
  console.log(`
${c.bold}limbo${c.reset} - personal AI memory agent

${c.bold}Usage:${c.reset}
  npx limbo [command]

${c.bold}Commands:${c.reset}
  start         Install and start Limbo (default if no command given)
  stop          Stop the running container
  logs          Tail container logs
  update        Pull latest image and restart
  status        Show container status
  help          Show this help

${c.bold}Flags:${c.reset}
  --reconfigure  Reconfigure auth and onboarding settings (use with start)

${c.bold}Data directory:${c.reset} ${LIMBO_DIR}
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, cmd = 'start'] = process.argv;

(async () => {
  switch (cmd) {
    case 'start':
    case 'install': await cmdStart(); break;
    case 'stop':    cmdStop(); break;
    case 'logs':    cmdLogs(); break;
    case 'update':  cmdUpdate(); break;
    case 'status':  cmdStatus(); break;
    case 'help':
    case '--help':
    case '-h':      cmdHelp(); break;
    default:
      warn(t('en', 'unknownCommand', cmd));
      cmdHelp();
      process.exit(1);
  }
})().catch((err) => {
  die(err.message || String(err));
});
