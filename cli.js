#!/usr/bin/env node
// cli.js — Limbo CLI
// Orchestrates the Docker-based Limbo runtime.
'use strict';

const { execSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// ─── Config ──────────────────────────────────────────────────────────────────

const LIMBO_DIR = path.join(os.homedir(), '.limbo');
const VAULT_DIR = path.join(LIMBO_DIR, 'vault');
const SECRETS_DIR = path.join(LIMBO_DIR, 'secrets');
const ENV_FILE = path.join(LIMBO_DIR, '.env');
const COMPOSE_FILE = path.join(LIMBO_DIR, 'docker-compose.yml');
const GHCR_IMAGE = 'ghcr.io/tomasward1/limbo';
const DEFAULT_TAG = require('./package.json').version;
const PORT = 18789;
// OpenClaw's OAuth callback server port — must be exposed when running auth inside Docker
const OPENCLAW_AUTH_PORT = 1453;

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
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
      - ./vault:/data/vault
      - limbo-openclaw-state:/home/limbo/.openclaw
    secrets:
      - llm_api_key
      - telegram_bot_token
      - gateway_token
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

secrets:
  llm_api_key:
    file: ./secrets/llm_api_key
  telegram_bot_token:
    file: ./secrets/telegram_bot_token
  gateway_token:
    file: ./secrets/gateway_token

volumes:
  limbo-data:
  limbo-openclaw-state:
`;

// Hardened variant: adds Squid egress proxy sidecar with domain allowlist
const COMPOSE_CONTENT_HARDENED = `services:
  limbo:
    image: ${GHCR_IMAGE}:${DEFAULT_TAG}
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
      - ./vault:/data/vault
      - limbo-openclaw-state:/home/limbo/.openclaw
    secrets:
      - llm_api_key
      - telegram_bot_token
      - gateway_token
    env_file:
      - .env
    environment:
      OPENCLAW_CONFIG_PATH: /home/limbo/.openclaw/openclaw.json
      OPENCLAW_STATE_DIR: /home/limbo/.openclaw
      HTTP_PROXY: http://squid:3128
      HTTPS_PROXY: http://squid:3128
      NO_PROXY: "127.0.0.1,localhost"
    networks:
      - internal
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

  squid:
    image: ubuntu/squid:latest
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    tmpfs:
      - /var/spool/squid:size=50M
      - /var/log/squid:size=10M
      - /var/run:size=5M
    networks:
      - internal
      - external
    volumes:
      - ./squid/squid.conf:/etc/squid/squid.conf:ro
      - ./squid/allowed-domains.txt:/etc/squid/allowed-domains.txt:ro

networks:
  internal:
    internal: true
  external:

secrets:
  llm_api_key:
    file: ./secrets/llm_api_key
  telegram_bot_token:
    file: ./secrets/telegram_bot_token
  gateway_token:
    file: ./secrets/gateway_token

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
    invalidModel: 'That model is not supported for this provider and access method.',
    supportedModels: 'Supported models:',
    openAiApiKeyPrompt: '  OpenAI API key (sk-...): ',
    anthropicApiKeyPrompt: '  Anthropic API key (sk-ant-...): ',
    requiredField: 'This field is required.',
    invalidOpenAIKey: 'OpenAI API keys usually start with "sk-".',
    invalidAnthropicKey: 'Anthropic API keys usually start with "sk-ant-".',
    telegramQuestion: 'Want to speak to Limbo through Telegram?',
    telegramBotFatherSteps: [
      'To create a Telegram bot:',
      '  1. Open @BotFather: https://t.me/BotFather',
      '  2. Send the command: /newbot',
      '  3. Choose a display name for your bot (e.g. "My Limbo")',
      '  4. Choose a username ending in "bot" (e.g. "my_limbo_bot")',
      '  5. BotFather will reply with a token like:',
      '       123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      '  6. Copy that token and paste it below.',
    ],
    telegramTokenSafe: 'Your token is stored locally in ~/.limbo/.env and never sent anywhere.',
    telegramTokenPrompt: '  Telegram bot token: ',
    telegramAutoPairQuestion: 'Auto-approve the first Telegram DM? (Convenient but less secure)',
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
    openaiSubscriptionIntro: 'Limbo will authenticate with your AI provider. A URL will appear — open it in your browser to complete login.',
    anthropicSubscriptionIntro: 'Generate a Claude setup-token on any machine with `claude setup-token`, then paste it into the next step.',
    authFlowStart: 'Starting authentication...',
    authFlowDone: 'Authentication complete.',
    modelConnected: (model) => `Model connected: ${model}`,
    authFlowFailed: 'Authentication did not complete successfully.',
    authStatusFailed: 'Provider auth is still missing or invalid. Try running with --reconfigure.',
    configFlowStart: 'Applying configuration...',
    configFlowDone: 'Configuration applied.',
    configFlowFailed: 'Could not apply configuration. Check your settings and try again.',
    composing: 'Initializing...',
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
    securityNotice: 'Security notice: Limbo runs AI agents inside a Docker container with access to your API keys and vault data. The container can make network requests to AI provider APIs. Do not store sensitive secrets (passwords, private keys) in your vault notes.',
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
    invalidModel: 'Ese modelo no esta soportado para este provider y metodo de acceso.',
    supportedModels: 'Modelos soportados:',
    openAiApiKeyPrompt: '  OpenAI API key (sk-...): ',
    anthropicApiKeyPrompt: '  Anthropic API key (sk-ant-...): ',
    requiredField: 'Este campo es obligatorio.',
    invalidOpenAIKey: 'Las API keys de OpenAI normalmente empiezan con "sk-".',
    invalidAnthropicKey: 'Las API keys de Anthropic normalmente empiezan con "sk-ant-".',
    telegramQuestion: 'Quieres hablar con Limbo por Telegram?',
    telegramBotFatherSteps: [
      'Para crear un bot de Telegram:',
      '  1. Abri @BotFather: https://t.me/BotFather',
      '  2. Manda el comando: /newbot',
      '  3. Elegí un nombre para tu bot (ej: "Mi Limbo")',
      '  4. Elegí un username que termine en "bot" (ej: "mi_limbo_bot")',
      '  5. BotFather te va a responder con un token como este:',
      '       123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      '  6. Copiá ese token y pegalo abajo.',
    ],
    telegramTokenSafe: 'Tu token se guarda localmente en ~/.limbo/.env y nunca se envia a ningun servidor externo.',
    telegramTokenPrompt: '  Telegram bot token: ',
    telegramAutoPairQuestion: 'Auto-aprobar el primer DM de Telegram? (Conveniente pero menos seguro)',
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
    openaiSubscriptionIntro: 'Limbo va a autenticarse con tu proveedor de IA. Aparecera una URL — abrisla en el navegador para completar el login.',
    anthropicSubscriptionIntro: 'Genera un Claude setup-token en cualquier maquina con `claude setup-token` y pegalo en el siguiente paso.',
    authFlowStart: 'Iniciando autenticacion...',
    authFlowDone: 'Autenticacion completada.',
    modelConnected: (model) => `Modelo conectado: ${model}`,
    authFlowFailed: 'La autenticacion no termino correctamente.',
    authStatusFailed: 'La autenticacion del provider sigue siendo invalida o no esta configurada. Proba con --reconfigure.',
    configFlowStart: 'Aplicando configuracion...',
    configFlowDone: 'Configuracion aplicada.',
    configFlowFailed: 'No se pudo aplicar la configuracion. Revisa los ajustes e intenta de nuevo.',
    composing: 'Inicializando...',
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
    securityNotice: 'Aviso de seguridad: Limbo corre agentes de IA dentro de un container Docker con acceso a tus API keys y datos del vault. El container puede hacer requests a las APIs de los proveedores de IA. No guardes secretos sensibles (passwords, claves privadas) en las notas del vault.',
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
    TELEGRAM_AUTO_PAIR_FIRST_DM: cfg.telegramAutoPair || existingEnv.TELEGRAM_AUTO_PAIR_FIRST_DM || 'false',
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };

  return base;
}

function writeSecretFile(name, value) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const filePath = path.join(SECRETS_DIR, name);
  fs.writeFileSync(filePath, value || '', { mode: 0o600 });
}

function writeSecrets(cfg, existingEnv = {}) {
  const normalized = normalizeConfig(cfg, existingEnv);
  writeSecretFile('llm_api_key', normalized.LLM_API_KEY);
  writeSecretFile('telegram_bot_token', normalized.TELEGRAM_BOT_TOKEN);
  writeSecretFile('gateway_token', normalized.OPENCLAW_GATEWAY_TOKEN);
}

const SECRET_KEYS = new Set([
  'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'TELEGRAM_BOT_TOKEN', 'OPENCLAW_GATEWAY_TOKEN',
]);

function writeEnv(cfg, existingEnv = {}) {
  writeSecrets(cfg, existingEnv);
  const content = Object.entries(normalizeConfig(cfg, existingEnv))
    .filter(([key]) => !SECRET_KEYS.has(key))
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
  let telegramAutoPair = 'false';
  if (telegramChoice.value === 'true') {
    console.log('');
    TEXT[language].telegramBotFatherSteps.forEach((line) => console.log(`  ${c.dim}${line}${c.reset}`));
    console.log(`  ${c.yellow}${TEXT[language].telegramTokenSafe}${c.reset}`);
    console.log('');
    telegramToken = await promptValidated(
      t(language, 'telegramTokenPrompt'),
      (value) => value ? { ok: true, value } : { ok: false, message: t(language, 'requiredField') },
    );
    const autoPairChoice = await selectMenu(t(language, 'telegramAutoPairQuestion'), [
      { label: t(language, 'no'), value: 'false' },
      { label: t(language, 'yes'), value: 'true' },
    ], language);
    telegramAutoPair = autoPairChoice.value;
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
    telegramAutoPair,
    gatewayToken: existingEnv.OPENCLAW_GATEWAY_TOKEN || generateGatewayToken(),
  };
}

function ensureComposeFile(hardened = false) {
  fs.mkdirSync(LIMBO_DIR, { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'maps'), { recursive: true });
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  // Ensure secret files exist (Docker Compose secrets require the files to be present)
  for (const name of ['llm_api_key', 'telegram_bot_token', 'gateway_token']) {
    const fp = path.join(SECRETS_DIR, name);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, '', { mode: 0o600 });
  }
  if (hardened) {
    // Copy squid config files for egress filtering
    const squidDir = path.join(LIMBO_DIR, 'squid');
    fs.mkdirSync(squidDir, { recursive: true });
    const srcSquidDir = path.join(__dirname, 'squid');
    for (const file of ['squid.conf', 'allowed-domains.txt']) {
      const src = path.join(srcSquidDir, file);
      const dest = path.join(squidDir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    }
  }
  fs.writeFileSync(COMPOSE_FILE, hardened ? COMPOSE_CONTENT_HARDENED : COMPOSE_CONTENT);
}

function readSecretFile(name) {
  const fp = path.join(SECRETS_DIR, name);
  try { return fs.readFileSync(fp, 'utf8').trim(); } catch { return ''; }
}

function ensureGatewayToken(existingEnv) {
  // Check secret file first, then legacy env
  const fromFile = readSecretFile('gateway_token');
  if (fromFile) return fromFile;
  if (existingEnv.OPENCLAW_GATEWAY_TOKEN) {
    writeSecretFile('gateway_token', existingEnv.OPENCLAW_GATEWAY_TOKEN);
    return existingEnv.OPENCLAW_GATEWAY_TOKEN;
  }
  writeEnv({ keepExisting: true }, existingEnv);
  return readSecretFile('gateway_token');
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

// Strip ANSI escape sequences so URL/text matching works on TTY output.
const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

// Spawn OpenClaw auth with filtered output: extract OAuth URLs, suppress branding.
// --tty is required so openclaw sees a TTY inside the container and runs the auth wizard.
// We pipe stdout/stderr to filter content while the container gets a proper PTY allocation.
// onUrl: optional callback invoked with each unique URL as it appears (e.g. to auto-open browser).
function streamFilteredAuth(dockerArgs, onUrl = null) {
  return new Promise((resolve) => {
    const proc = spawn('docker', dockerArgs, {
      cwd: LIMBO_DIR,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const urlRe = /https?:\/\/[^\s"'<>\]]+/g;
    const seenUrls = new Set();
    let buf = '';

    const handleData = (data) => {
      buf += data.toString();
      // Split on \r\n, \n, or bare \r — TUIs use carriage returns for in-place redraws
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop(); // hold incomplete last line
      for (const line of lines) emitLine(line);
    };

    const emitLine = (rawLine) => {
      const line = stripAnsi(rawLine);
      const urls = line.match(urlRe) || [];
      if (urls.length > 0) {
        for (const url of urls) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            console.log(`\n  ${c.cyan}${c.bold}→  ${url}${c.reset}\n`);
            if (onUrl) onUrl(url);
          }
        }
        return; // don't double-print the line containing the URL
      }
      // Suppress OpenClaw branding; show everything else (prompts, status, interactive questions)
      if (/openclaw/i.test(line)) return;
      if (line.trim()) console.log(`   ${line}`);
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);
    proc.on('close', (code) => {
      if (buf.trim()) emitLine(buf);
      resolve(code ?? 1);
    });
    proc.on('error', () => resolve(1));
  });
}

async function runSubscriptionAuthFlow(cfg) {
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

  let exitCode;
  if (cfg.providerFamily === 'openai') {
    // --tty allocates a PTY inside the container so openclaw's auth wizard runs correctly.
    // -p exposes the OAuth callback port so the browser redirect reaches the in-container server.
    // We still pipe stdout/stderr to filter out branding and highlight the OAuth URL.
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exitCode = await streamFilteredAuth(
      ['compose', 'run', '--tty', '--rm', '-p', `${OPENCLAW_AUTH_PORT}:${OPENCLAW_AUTH_PORT}`, '--entrypoint', 'openclaw', 'limbo', ...authArgs],
      (url) => {
        // Auto-open the browser so the user doesn't need to copy/paste the URL
        try { spawnSync(opener, [url], { stdio: 'ignore', timeout: 3000 }); } catch {}
      },
    );
  } else {
    // Anthropic paste-token is interactive (user pastes a token); keep stdio inherited
    const authResult = runOpenClaw(authArgs);
    exitCode = authResult.status;
  }

  if (exitCode !== 0) die(t(cfg.language, 'authFlowFailed'));

  const statusResult = runOpenClaw(
    ['models', 'status', '--check', '--probe-provider', cfg.provider],
    { stdio: 'pipe' },
  );

  if (statusResult.status !== 0) {
    process.stdout.write(statusResult.stdout || '');
    process.stderr.write(statusResult.stderr || '');
    die(t(cfg.language, 'authStatusFailed'));
  }

  ok(t(cfg.language, 'modelConnected', `${cfg.provider}/${cfg.modelName}`));
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

  const hardened = process.argv.includes('--hardened');
  ensureComposeFile(hardened);

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
    await runSubscriptionAuthFlow(cfg);
  }

  applyOpenClawConfig({
    ...cfg,
    telegramToken: mergedEnv.TELEGRAM_BOT_TOKEN || cfg.telegramToken || '',
    telegramEnabled: mergedEnv.TELEGRAM_ENABLED || cfg.telegramEnabled || 'false',
  });

  header(t(cfg.language, 'starting'));
  log(t(cfg.language, 'composing'));
  const upResult = runDockerCompose(['up', '-d', '--remove-orphans'], { stdio: 'pipe' });
  if (upResult.status !== 0) {
    process.stderr.write(upResult.stderr || '');
    die('Container failed to start. Run `limbo logs` to investigate.');
  }

  header(t(cfg.language, 'verifying'));
  const healthy = waitForHealthy(cfg.language);
  if (!healthy) {
    warn(t(cfg.language, 'healthTimeout'));
    warn(t(cfg.language, 'logsHint'));
  } else {
    ok(t(cfg.language, 'healthy'));
  }

  console.log(`\n  ${c.yellow}⚠  ${t(cfg.language, 'securityNotice')}${c.reset}\n`);

  printSuccess({
    language: cfg.language,
    telegramEnabled: mergedEnv.TELEGRAM_ENABLED || cfg.telegramEnabled || 'false',
  }, readSecretFile('gateway_token') || mergedEnv.OPENCLAW_GATEWAY_TOKEN);
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
  --hardened     Enable egress proxy (restricts outbound to AI provider APIs only)

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
