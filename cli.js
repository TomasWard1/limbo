#!/usr/bin/env node
// cli.js — Limbo CLI
// Orchestrates the Docker-based Limbo runtime.
'use strict';

const { execSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const readline = require('readline');

// ─── Config ──────────────────────────────────────────────────────────────────

// --home flag or LIMBO_HOME env var overrides the default ~/.limbo directory.
// Useful for testing without affecting the production install.
const LIMBO_DIR = (() => {
  const idx = process.argv.indexOf('--home');
  if (idx !== -1 && idx + 1 < process.argv.length) return path.resolve(process.argv[idx + 1]);
  if (process.env.LIMBO_HOME) return path.resolve(process.env.LIMBO_HOME);
  return path.join(os.homedir(), '.limbo');
})();
const VAULT_DIR = path.join(LIMBO_DIR, 'vault');
const OPENCLAW_STATE_DIR = path.join(LIMBO_DIR, 'openclaw-state');
const FLAGS_DIR = path.join(LIMBO_DIR, 'flags');
const CONFIG_DIR = path.join(LIMBO_DIR, 'config');
const ENV_FILE = path.join(CONFIG_DIR, '.env');
const ENV_BACKUP_FILE = path.join(CONFIG_DIR, '.env.bak');
// Control plane port offset — supervisor listens on LIMBO_PORT + 2 inside
// the container, published to the host loopback via Docker port mapping.
// The offset (not an absolute number) means multi-instance installs on
// custom ports don't collide.
const CONTROL_PORT_OFFSET = 2;
// Fixed wizard port for Google OAuth callback — every Limbo install uses the
// same port so a single redirect URI can be registered in Google Console.
// Override via LIMBO_WIZARD_PORT env var for edge cases (multi-instance).
const DEFAULT_WIZARD_PORT = 15789;
const COMPOSE_FILE = path.join(LIMBO_DIR, 'docker-compose.yml');
const DEFAULT_REGISTRY = 'registry.gitlab.com/tomas209/limbo';
const REGISTRY_IMAGE = process.env.LIMBO_REGISTRY || DEFAULT_REGISTRY;
const DEFAULT_TAG = 'latest';
const IMAGE_OVERRIDE = process.env.LIMBO_IMAGE || null;
const DEFAULT_PORT = 18789;
const COEXIST_PORT = 18900;
let PORT = DEFAULT_PORT;

const PROVISION_API_URL = 'https://api.heylimbo.com';
const PROVISION_SECRET = 'limbo-provision-2026';

// ─── Port Conflict Detection ────────────────────────────────────────────────

function isPortInUse(port) {
  try {
    execSync(
      `node -e "const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500);"`,
      { stdio: 'pipe', timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

function detectPortConflict() {
  if (!isPortInUse(DEFAULT_PORT)) return null;

  let processInfo = 'unknown process';
  try {
    const lsof = execSync(`lsof -i :${DEFAULT_PORT} -t 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (lsof) {
      const pid = lsof.split('\n')[0];
      const cmdline = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (cmdline.includes('openclaw')) processInfo = 'OpenClaw';
      else if (cmdline.includes('docker')) processInfo = 'Docker container';
      else processInfo = cmdline.slice(0, 60);
    }
  } catch { /* lsof not available or no match */ }

  return { port: DEFAULT_PORT, processInfo };
}

function findExistingApiKeys() {
  // Probe for an existing OpenClaw standalone install whose credentials we
  // can offer to reuse. These paths are for OpenClaw, not Limbo — Limbo
  // itself writes to ~/.limbo/config/.env, which is handled elsewhere.
  const searchPaths = [
    path.join(os.homedir(), '.openclaw', '.env'),
    '/opt/openclaw/.env',
    '/opt/openclaw/secrets/llm_api_key',
  ];

  for (const envPath of searchPaths) {
    try {
      if (!fs.existsSync(envPath)) continue;

      // If it's a secrets file (single value), read directly
      if (envPath.endsWith('llm_api_key')) {
        const key = fs.readFileSync(envPath, 'utf8').trim();
        if (key) return { source: path.dirname(envPath), keys: { LLM_API_KEY: key } };
        continue;
      }

      // Parse .env file
      const content = fs.readFileSync(envPath, 'utf8');
      const keys = {};
      for (const line of content.split('\n')) {
        const match = line.match(/^(LLM_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|MODEL_PROVIDER|MODEL_NAME)=(.+)$/);
        if (match) keys[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
      }
      const hasKey = keys.LLM_API_KEY || keys.ANTHROPIC_API_KEY || keys.OPENAI_API_KEY || keys.OPENROUTER_API_KEY;
      if (hasKey) return { source: path.dirname(envPath), keys };
    } catch { /* permission denied etc — skip */ }
  }

  return null;
}

// OpenClaw compatibility snapshots from official docs:
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
  'openrouter:api-key': {
    provider: 'openrouter',
    defaultModel: 'auto',
    menuModels: [],
    supportedModels: [],
  },
};

const ASCII_ART = String.raw`
 _     ___ __  __ ____   ___
| |   |_ _|  \/  | __ ) / _ \
| |    | || |\/| |  _ \| | | |
| |___ | || |  | | |_) | |_| |
|_____|___|_|  |_|____/ \___/
`;

function resolveImage() {
  return IMAGE_OVERRIDE || parseFlag('--image') || `${REGISTRY_IMAGE}:${DEFAULT_TAG}`;
}

function resolveExtraEnv() {
  const extra = [];
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      extra.push(args[i + 1]);
      i++;
    }
  }
  if (!extra.length) return '';
  return extra.map(e => `      ${e.split('=')[0]}: "${e.split('=').slice(1).join('=')}"`).join('\n') + '\n';
}

// docker-compose.yml written to ~/.limbo on install
function composeContent() {
  const wizardPort = parseInt(process.env.LIMBO_WIZARD_PORT, 10) || DEFAULT_WIZARD_PORT;
  const publicUrl = parseEnvFile().LIMBO_PUBLIC_URL || '';
  return `services:
  limbo:
    image: ${resolveImage()}
    init: true
    restart: unless-stopped
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETUID
      - SETGID
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev,uid=999,gid=999
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
      # Wizard port (fixed for Google OAuth callback URI).
      - "127.0.0.1:${wizardPort}:${wizardPort}"
      # Control plane (LIMBO_PORT + 2) — host CLI talks to the supervisor here.
      - "127.0.0.1:${PORT + CONTROL_PORT_OFFSET}:${PORT + CONTROL_PORT_OFFSET}"
${publicUrl ? '      # Public server (Cloudflare-facing, wizard + static page)\n      - "0.0.0.0:80:80"\n' : ''}
    volumes:
      - limbo-data:/data
      - ${VAULT_DIR}:/data/vault
      - ${OPENCLAW_STATE_DIR}:/home/limbo/.openclaw
      - ${CONFIG_DIR}:/data/config
      - ${FLAGS_DIR}:/flags
    env_file:
      - ${ENV_FILE}
    environment:
      LIMBO_PORT: "${PORT}"
      LIMBO_WIZARD_PORT: "${wizardPort}"
      NODE_OPTIONS: "\${LIMBO_NODE_OPTIONS:---max-old-space-size=512}"
${resolveExtraEnv()}    healthcheck:
      test:
        - CMD-SHELL
        - node -e "fetch('http://localhost:${PORT}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  limbo-data:
`;
}

// Hardened variant: adds Squid egress proxy sidecar with domain allowlist
function composeContentHardened() {
  const wizardPort = parseInt(process.env.LIMBO_WIZARD_PORT, 10) || DEFAULT_WIZARD_PORT;
  const publicUrl = parseEnvFile().LIMBO_PUBLIC_URL || '';
  return `services:
  limbo:
    image: ${resolveImage()}
    init: true
    restart: unless-stopped
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETUID
      - SETGID
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev,uid=999,gid=999
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
      # Wizard port (fixed for Google OAuth callback URI).
      - "127.0.0.1:${wizardPort}:${wizardPort}"
      # Control plane (LIMBO_PORT + 2) — host CLI talks to the supervisor here.
      - "127.0.0.1:${PORT + CONTROL_PORT_OFFSET}:${PORT + CONTROL_PORT_OFFSET}"
${publicUrl ? '      # Public server (Cloudflare-facing, wizard + static page)\n      - "0.0.0.0:80:80"\n' : ''}
    volumes:
      - limbo-data:/data
      - ${VAULT_DIR}:/data/vault
      - ${OPENCLAW_STATE_DIR}:/home/limbo/.openclaw
      - ${CONFIG_DIR}:/data/config
      - ${FLAGS_DIR}:/flags
    env_file:
      - ${ENV_FILE}
    environment:
      LIMBO_PORT: "${PORT}"
      LIMBO_WIZARD_PORT: "${wizardPort}"
      NODE_OPTIONS: "\${LIMBO_NODE_OPTIONS:---max-old-space-size=512}"
      HTTP_PROXY: http://squid:3128
      HTTPS_PROXY: http://squid:3128
      NO_PROXY: "127.0.0.1,localhost"
${resolveExtraEnv()}    networks:
      - internal
    healthcheck:
      test:
        - CMD-SHELL
        - node -e "fetch('http://localhost:${PORT}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

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
      - ${LIMBO_DIR}/squid/squid.conf:/etc/squid/squid.conf:ro
      - ${LIMBO_DIR}/squid/allowed-domains.txt:/etc/squid/allowed-domains.txt:ro

networks:
  internal:
    internal: true
  external:

volumes:
  limbo-data:
`;
}

const TEXT = {
  en: {
    languageName: 'English',
    chooseLanguage: 'Choose your language',
    menuHelp: 'Use arrow keys and press Enter.',
    providerQuestion: 'AI Provider',
    providerOpenAI: 'Codex (OpenAI)',
    providerAnthropic: 'Claude (Anthropic)',
    providerOpenRouter: 'OpenRouter (100+ models)',
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
    openRouterApiKeyPrompt: '  OpenRouter API key (sk-or-...): ',
    openRouterKeyWarn: 'OpenRouter API keys usually start with "sk-or-". Proceeding anyway.',
    openRouterKeyHint: 'Get your key at: https://openrouter.ai/keys',
    openRouterModelPrompt: '  Model name (blank = auto-routing): ',
    openRouterModelHint: 'Examples: anthropic/claude-sonnet-4-6, openai/gpt-4o, google/gemini-2.5-pro',
    optionalFeatures: 'Optional features',
    voiceQuestion: 'Enable voice transcription? (Requires Groq API key)',
    groqApiKeyPrompt: '  Groq API key (gsk_...): ',
    groqApiKeyHint: 'Get your free key at: https://console.groq.com/keys',
    invalidGroqKey: 'Groq API keys usually start with "gsk_". Proceeding anyway.',
    webSearchQuestion: 'Enable web search? (Requires Brave Search API key)',
    braveApiKeyPrompt: '  Brave API key (BSA...): ',
    braveApiKeyHint: 'Get your key at: https://brave.com/search/api/',
    invalidBraveKey: 'Brave API keys usually start with "BSA". Proceeding anyway.',
    reviewHeader: 'Review your configuration',
    reviewConfirm: 'Proceed with this configuration?',
    reviewStartOver: 'Start over',
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
    pullFailed: 'Could not pull from GitLab Container Registry. Trying local build fallback...',
    buildingFallback: 'Building from local Dockerfile...',
    buildOk: (tag) => `Built: ${REGISTRY_IMAGE}:${tag}`,
    starting: 'Starting Limbo...',
    healthy: 'Limbo started.',
    subscriptionSetup: 'Provider authentication',
    openaiSubscriptionIntro: 'Limbo will authenticate with your OpenAI account. A URL will open in your browser — log in and authorize access.',
    anthropicSubscriptionIntro: 'Generate a Claude setup-token on any machine with `claude setup-token`, then paste it into the next step.',
    claudeTokenPrompt: '  Setup token: ',
    claudeTokenInvalid: 'Invalid token. It should start with "sk-ant-".',
    claudeTokenWritten: 'Auth profile written.',
    authFlowStart: 'Starting authentication...',
    authFlowDone: 'Authentication complete.',
    authFlowFailed: 'Authentication did not complete successfully.',
    authStatusFailed: 'Provider auth is still missing or invalid. Try running with --reconfigure.',
    oauthPasteHint: 'After you log in, the browser will redirect to a localhost URL (it may show an error page — that\'s normal). Copy the full URL from the address bar and paste it below.',
    oauthCallbackPrompt: '  Paste the callback URL: ',
    oauthInvalidCallback: 'Could not extract an authorization code from that input. Paste the full URL from the browser address bar.',
    oauthExchanging: 'Exchanging authorization code for tokens...',
    oauthStateMismatch: 'OAuth state mismatch — proceeding anyway, but this may indicate a problem.',
    configFlowStart: 'Applying configuration...',
    configFlowSlow: 'This may take a couple of minutes.',
    configFlowDone: 'Configuration applied.',
    configFlowFailed: 'Could not apply configuration. Check your settings and try again.',
    configOom: 'Configuration failed: out of memory. The server does not have enough free RAM.',
    configOomContainers: (n) => `  Found ${n} running Limbo container(s) using memory. Stop them first:\n    npx limbo stop`,
    configOomHint: '  Try closing other programs or upgrading to a server with more RAM.',
    configOomOverride: '  If your server has enough RAM, increase the limit in .env:\n    LIMBO_NODE_OPTIONS=--max-old-space-size=2048',
    staleContainersFound: (n) => `Found ${n} running Limbo container(s). Stopping to free memory...`,
    staleContainersStopped: 'Stopped existing containers.',

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
    dockerMissing: 'Docker is not installed or the Compose plugin is missing.\n  Docker Engine: https://docs.docker.com/engine/install/\n  Compose plugin: sudo apt-get install docker-compose-plugin',
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
    headlessMissingApiKey: '--provider requires --api-key. Subscription auth needs interactive setup: npx limbo-ai start',
    headlessInvalidProvider: 'Invalid --provider. Use: openai, anthropic, or openrouter',
    headlessStarting: 'Headless mode: configuring...',
    helpProvider: 'Set provider for headless install (openai, anthropic, openrouter)',
    helpApiKey: 'API key for headless install',
    helpModel: 'Model name (optional, uses provider default)',
    helpLanguage: 'Language: en, es (default: en)',
  },
  es: {
    languageName: 'Espanol',
    chooseLanguage: 'Elige tu idioma',
    menuHelp: 'Usa las flechas y Enter.',
    providerQuestion: 'AI Provider',
    providerOpenAI: 'Codex (OpenAI)',
    providerAnthropic: 'Claude (Anthropic)',
    providerOpenRouter: 'OpenRouter (100+ modelos)',
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
    openRouterApiKeyPrompt: '  OpenRouter API key (sk-or-...): ',
    openRouterKeyWarn: 'Las API keys de OpenRouter normalmente empiezan con "sk-or-". Continuando igual.',
    openRouterKeyHint: 'Consegui tu key en: https://openrouter.ai/keys',
    openRouterModelPrompt: '  Nombre del modelo (vacio = auto-routing): ',
    openRouterModelHint: 'Ejemplos: anthropic/claude-sonnet-4-6, openai/gpt-4o, google/gemini-2.5-pro',
    optionalFeatures: 'Funciones opcionales',
    voiceQuestion: 'Habilitar transcripcion de voz? (Requiere API key de Groq)',
    groqApiKeyPrompt: '  Groq API key (gsk_...): ',
    groqApiKeyHint: 'Consegui tu key gratis en: https://console.groq.com/keys',
    invalidGroqKey: 'Las API keys de Groq normalmente empiezan con "gsk_". Continuando igual.',
    webSearchQuestion: 'Habilitar busqueda web? (Requiere API key de Brave Search)',
    braveApiKeyPrompt: '  Brave API key (BSA...): ',
    braveApiKeyHint: 'Consegui tu key en: https://brave.com/search/api/',
    invalidBraveKey: 'Las API keys de Brave normalmente empiezan con "BSA". Continuando igual.',
    reviewHeader: 'Revisa tu configuracion',
    reviewConfirm: 'Continuar con esta configuracion?',
    reviewStartOver: 'Empezar de nuevo',
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
    pullFailed: 'No se pudo bajar la imagen desde GitLab Container Registry. Probando build local...',
    buildingFallback: 'Construyendo desde el Dockerfile local...',
    buildOk: (tag) => `Imagen construida: ${REGISTRY_IMAGE}:${tag}`,
    starting: 'Arrancando Limbo...',
    healthy: 'Limbo arrancó.',
    subscriptionSetup: 'Autenticacion del provider',
    openaiSubscriptionIntro: 'Limbo va a autenticarse con tu cuenta de OpenAI. Se va a abrir una URL en tu navegador — inicia sesion y autoriza el acceso.',
    anthropicSubscriptionIntro: 'Genera un Claude setup-token en cualquier maquina con `claude setup-token` y pegalo en el siguiente paso.',
    claudeTokenPrompt: '  Setup token: ',
    claudeTokenInvalid: 'Token invalido. Deberia empezar con "sk-ant-".',
    claudeTokenWritten: 'Perfil de auth guardado.',
    authFlowStart: 'Iniciando autenticacion...',
    authFlowDone: 'Autenticacion completada.',
    authFlowFailed: 'La autenticacion no termino correctamente.',
    authStatusFailed: 'La autenticacion del provider sigue siendo invalida o no esta configurada. Proba con --reconfigure.',
    oauthPasteHint: 'Despues de loguearte, el browser va a redirigir a una URL de localhost (puede mostrar una pagina de error — es normal). Copa la URL completa de la barra de direcciones y pegala abajo.',
    oauthCallbackPrompt: '  Pega la URL de callback: ',
    oauthInvalidCallback: 'No se pudo extraer un codigo de autorizacion. Pega la URL completa de la barra del navegador.',
    oauthExchanging: 'Intercambiando codigo de autorizacion por tokens...',
    oauthStateMismatch: 'OAuth state mismatch — se continua igual, pero esto puede indicar un problema.',
    configFlowStart: 'Aplicando configuracion...',
    configFlowSlow: 'Esto puede tardar un par de minutos.',
    configFlowDone: 'Configuracion aplicada.',
    configFlowFailed: 'No se pudo aplicar la configuracion. Revisa los ajustes e intenta de nuevo.',
    configOom: 'La configuracion fallo: sin memoria. El servidor no tiene suficiente RAM libre.',
    configOomContainers: (n) => `  Se encontraron ${n} container(s) de Limbo corriendo que usan memoria. Frenalos primero:\n    npx limbo stop`,
    configOomHint: '  Proba cerrando otros programas o usando un servidor con mas RAM.',
    configOomOverride: '  Si tu servidor tiene suficiente RAM, podes aumentar el limite en .env:\n    LIMBO_NODE_OPTIONS=--max-old-space-size=2048',
    staleContainersFound: (n) => `Se encontraron ${n} container(s) de Limbo corriendo. Frenando para liberar memoria...`,
    staleContainersStopped: 'Containers existentes frenados.',

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
    dockerMissing: 'Docker no esta instalado o falta el plugin Compose.\n  Docker Engine: https://docs.docker.com/engine/install/\n  Plugin Compose: sudo apt-get install docker-compose-plugin',
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
    headlessMissingApiKey: '--provider requiere --api-key. La autenticacion por suscripcion necesita setup interactivo: npx limbo-ai start',
    headlessInvalidProvider: '--provider invalido. Usa: openai, anthropic, o openrouter',
    headlessStarting: 'Modo headless: configurando...',
    helpProvider: 'Setea el provider para instalacion headless (openai, anthropic, openrouter)',
    helpApiKey: 'API key para instalacion headless',
    helpModel: 'Nombre del modelo (opcional, usa el default del provider)',
    helpLanguage: 'Idioma: en, es (default: en)',
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

// Single-line spinner: overwrites the same line on TTY, falls back to log() on pipe/CI.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _spinnerFrame = 0;
function spinnerWrite(msg) {
  if (process.stdout.isTTY) {
    const frame = SPINNER_FRAMES[_spinnerFrame++ % SPINNER_FRAMES.length];
    const line = `\r${c.cyan}[limbo]${c.reset} ${frame} ${msg}`;
    process.stdout.write(line.padEnd(process.stdout.columns || 80));
  } else {
    log(msg);
  }
}
function spinnerClear() {
  if (process.stdout.isTTY) {
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function t(lang, key, ...args) {
  const value = TEXT[lang][key];
  return typeof value === 'function' ? value(...args) : value;
}

function parseFlag(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
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
      const key = line.slice(0, idx);
      // Strip surrounding quotes defensively — older wizard writes and some
      // manual edits use KEY="value" formatting. cli.js itself writes raw
      // KEY=value, so we normalize on read.
      const raw = line.slice(idx + 1);
      const unquoted = raw.replace(/^["']|["']$/g, '');
      acc[key] = unquoted;
      return acc;
    }, {});
}

function generateGatewayToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeConfig(cfg, existingEnv = {}) {
  const gatewayToken = cfg.gatewayToken || existingEnv.GATEWAY_TOKEN || generateGatewayToken();
  const base = {
    CLI_LANGUAGE: cfg.language || existingEnv.CLI_LANGUAGE || 'en',
    AUTH_MODE: cfg.authMode || existingEnv.AUTH_MODE || 'api-key',
    MODEL_PROVIDER: cfg.provider || existingEnv.MODEL_PROVIDER || 'anthropic',
    MODEL_NAME: cfg.modelName || existingEnv.MODEL_NAME || 'claude-opus-4-6',
    LIMBO_PORT: String(PORT),
    OPENAI_API_KEY: cfg.provider === 'openai' && cfg.apiKey ? cfg.apiKey : (cfg.keepExisting ? existingEnv.OPENAI_API_KEY || '' : ''),
    ANTHROPIC_API_KEY: cfg.provider === 'anthropic' && cfg.apiKey ? cfg.apiKey : (cfg.keepExisting ? existingEnv.ANTHROPIC_API_KEY || '' : ''),
    LLM_API_KEY: cfg.apiKey || (cfg.keepExisting ? existingEnv.LLM_API_KEY || '' : ''),
    TELEGRAM_ENABLED: cfg.telegramEnabled || existingEnv.TELEGRAM_ENABLED || 'false',
    TELEGRAM_BOT_TOKEN: cfg.telegramToken || (cfg.keepExisting ? existingEnv.TELEGRAM_BOT_TOKEN || '' : ''),
    TELEGRAM_AUTO_PAIR_FIRST_DM: cfg.telegramAutoPair || existingEnv.TELEGRAM_AUTO_PAIR_FIRST_DM || 'false',
    GATEWAY_TOKEN: gatewayToken,
    VOICE_ENABLED: cfg.voiceEnabled || existingEnv.VOICE_ENABLED || 'false',
    GROQ_API_KEY: cfg.groqApiKey || existingEnv.GROQ_API_KEY || '',
    WEB_SEARCH_ENABLED: cfg.webSearchEnabled || existingEnv.WEB_SEARCH_ENABLED || 'false',
    BRAVE_API_KEY: cfg.braveApiKey || existingEnv.BRAVE_API_KEY || '',
    GOOGLE_CALENDAR_ENABLED: cfg.googleCalendarEnabled || existingEnv.GOOGLE_CALENDAR_ENABLED || 'false',
  };

  return base;
}

// Write the .env atomically with a pre-write single-slot backup (.env.bak) so
// that a crashed write or a bad wizard run can be manually rolled back. Mode
// 0666 is chosen because the .env is also written from inside the container
// (uid 999, non-owner of the host-mounted config dir); world-writable on a file
// inside ~/.limbo does not widen exposure beyond what the home directory
// already permits. Explicit chmod after write defeats the process umask.
//
// All callers in cli.js MUST go through this helper rather than calling
// fs.writeFileSync(ENV_FILE, ...) directly — that's the only way to guarantee
// the container (uid 999) can rewrite the .env after the host CLI touches it.
function safeWriteEnvFile(content) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o777 });
  try { fs.chmodSync(CONFIG_DIR, 0o777); } catch { /* best effort */ }
  if (fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(ENV_FILE, ENV_BACKUP_FILE); } catch { /* best effort */ }
  }
  fs.writeFileSync(ENV_FILE, content, { mode: 0o666 });
  try { fs.chmodSync(ENV_FILE, 0o666); } catch { /* best effort */ }
}

// Quote a .env value if it contains shell metacharacters. Simple values
// (alphanumeric, dots, slashes, dashes, colons, underscores) stay unquoted.
// Everything else gets double-quoted with escaping.
function quoteEnvValue(v) {
  const s = String(v);
  if (/^[A-Za-z0-9._:\/\-+=]*$/.test(s)) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function writeEnv(cfg, existingEnv = {}) {
  // Skip keys with empty string values to keep the .env clean. The
  // provider-specific key aliases (OPENAI_API_KEY / ANTHROPIC_API_KEY) are
  // legacy compat shims — when unused they just add noise. LLM_API_KEY is
  // always populated in api-key mode, so the active key always lands.
  const content = Object.entries(normalizeConfig(cfg, existingEnv))
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join('\n') + '\n';
  safeWriteEnvFile(content);
}


function deriveProviderFamily(provider) {
  if (!provider) return 'anthropic';
  if (provider.startsWith('openai')) return 'openai';
  if (provider === 'openrouter') return 'openrouter';
  return 'anthropic';
}

function getModelCatalog(providerFamily, authMode) {
  return MODEL_CATALOG[`${providerFamily}:${authMode}`];
}

async function chooseModel(lang, providerFamily, authMode) {
  const catalog = getModelCatalog(providerFamily, authMode);

  if (!catalog.menuModels.length) {
    console.log(`  ${c.dim}${t(lang, 'openRouterModelHint')}${c.reset}`);
    const modelName = await promptValidated(
      t(lang, 'openRouterModelPrompt'),
      (value) => ({ ok: true, value: value || catalog.defaultModel }),
    );
    return modelName;
  }

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

  // Check for existing API keys from another installation
  const existingKeys = findExistingApiKeys();
  if (existingKeys && !existingEnv.LLM_API_KEY && !existingEnv.ANTHROPIC_API_KEY && !existingEnv.OPENAI_API_KEY) {
    const keyValue = existingKeys.keys.LLM_API_KEY || existingKeys.keys.ANTHROPIC_API_KEY || existingKeys.keys.OPENAI_API_KEY || existingKeys.keys.OPENROUTER_API_KEY || '';
    const maskedKey = keyValue ? keyValue.slice(0, 10) + '...' : 'found';

    console.log(`
  ${c.cyan}Found existing API keys${c.reset} from ${existingKeys.source}
  ${c.dim}Key: ${maskedKey}${c.reset}
`);

    const { select } = await getClack();
    const reuseChoice = await select({
      message: 'Reuse existing API configuration?',
      options: [
        { value: 'yes', label: 'Yes, use existing keys' },
        { value: 'no', label: 'No, configure new keys' },
      ],
    });
    await maybeHandleClackCancel(reuseChoice);

    if (reuseChoice === 'yes') {
      Object.assign(existingEnv, existingKeys.keys);
    }
  }

  const language = (await selectMenu(t('en', 'chooseLanguage'), [
    { label: TEXT.en.languageName, value: 'en' },
    { label: TEXT.es.languageName, value: 'es' },
  ], 'en')).value;

  const providerFamily = (await selectMenu(t(language, 'providerQuestion'), [
    { label: t(language, 'providerOpenAI'), value: 'openai' },
    { label: t(language, 'providerAnthropic'), value: 'anthropic' },
    { label: t(language, 'providerOpenRouter'), value: 'openrouter' },
  ], language)).value;

  let accessMethod;
  if (providerFamily === 'openrouter') {
    accessMethod = 'api-key';
  } else {
    accessMethod = (await selectMenu(t(language, 'accessMethodQuestion'), [
      {
        label: providerFamily === 'openai'
          ? t(language, 'accessSubscriptionOpenAI')
          : t(language, 'accessSubscriptionAnthropic'),
        value: 'subscription',
      },
      { label: t(language, 'accessApiKey'), value: 'api-key' },
    ], language)).value;
  }

  const modelName = await chooseModel(language, providerFamily, accessMethod);
  const provider = getModelCatalog(providerFamily, accessMethod).provider;
  let apiKey = '';

  if (accessMethod === 'api-key') {
    const reusedKey = existingEnv.LLM_API_KEY
      || (providerFamily === 'openai' && existingEnv.OPENAI_API_KEY)
      || (providerFamily === 'anthropic' && existingEnv.ANTHROPIC_API_KEY)
      || (providerFamily === 'openrouter' && existingEnv.OPENROUTER_API_KEY)
      || '';

    if (reusedKey) {
      apiKey = reusedKey;
    } else if (providerFamily === 'openai') {
      apiKey = await promptValidated(
        t(language, 'openAiApiKeyPrompt'),
        (value) => {
          if (!value) return { ok: false, message: t(language, 'requiredField') };
          if (!value.startsWith('sk-')) return { ok: false, message: t(language, 'invalidOpenAIKey') };
          return { ok: true, value };
        },
      );
    } else if (providerFamily === 'openrouter') {
      console.log(`  ${c.dim}${t(language, 'openRouterKeyHint')}${c.reset}`);
      apiKey = await promptValidated(
        t(language, 'openRouterApiKeyPrompt'),
        (value) => {
          if (!value) return { ok: false, message: t(language, 'requiredField') };
          if (!value.startsWith('sk-or-')) warn(t(language, 'openRouterKeyWarn'));
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
    console.log('');
    TEXT[language].telegramBotFatherSteps.forEach((line) => console.log(`  ${c.dim}${line}${c.reset}`));
    console.log(`  ${c.yellow}${TEXT[language].telegramTokenSafe}${c.reset}`);
    console.log('');
    telegramToken = await promptValidated(
      t(language, 'telegramTokenPrompt'),
      (value) => value ? { ok: true, value } : { ok: false, message: t(language, 'requiredField') },
    );
  }

  // ── Optional features ────────────────────────────────────────────────────
  header(t(language, 'optionalFeatures'));

  let voiceEnabled = 'false';
  let groqApiKey = '';
  const voiceChoice = await selectMenu(t(language, 'voiceQuestion'), [
    { label: t(language, 'no'), value: 'false' },
    { label: t(language, 'yes'), value: 'true' },
  ], language);
  if (voiceChoice.value === 'true') {
    console.log(`  ${c.dim}${t(language, 'groqApiKeyHint')}${c.reset}`);
    groqApiKey = await promptValidated(
      t(language, 'groqApiKeyPrompt'),
      (value) => {
        if (!value) return { ok: false, message: t(language, 'requiredField') };
        if (!value.startsWith('gsk_')) warn(t(language, 'invalidGroqKey'));
        return { ok: true, value };
      },
    );
    voiceEnabled = 'true';
  }

  let webSearchEnabled = 'false';
  let braveApiKey = '';
  const webSearchChoice = await selectMenu(t(language, 'webSearchQuestion'), [
    { label: t(language, 'no'), value: 'false' },
    { label: t(language, 'yes'), value: 'true' },
  ], language);
  if (webSearchChoice.value === 'true') {
    console.log(`  ${c.dim}${t(language, 'braveApiKeyHint')}${c.reset}`);
    braveApiKey = await promptValidated(
      t(language, 'braveApiKeyPrompt'),
      (value) => {
        if (!value) return { ok: false, message: t(language, 'requiredField') };
        if (!value.startsWith('BSA')) warn(t(language, 'invalidBraveKey'));
        return { ok: true, value };
      },
    );
    webSearchEnabled = 'true';
  }

  // ── Review step ──────────────────────────────────────────────────────────
  const providerLabel = providerFamily === 'openai' ? 'OpenAI'
    : providerFamily === 'anthropic' ? 'Anthropic' : 'OpenRouter';
  const authLabel = accessMethod === 'subscription' ? 'Subscription' : 'API key';
  const enabledLabel = language === 'es' ? 'habilitado' : 'enabled';
  const disabledLabel = language === 'es' ? 'deshabilitado' : 'disabled';

  header(t(language, 'reviewHeader'));
  console.log(`
  ${c.bold}Provider:${c.reset}      ${providerLabel}
  ${c.bold}Model:${c.reset}         ${modelName}
  ${c.bold}Auth:${c.reset}          ${authLabel}
  ${c.bold}Telegram:${c.reset}      ${telegramChoice.value === 'true' ? `${c.green}${enabledLabel}${c.reset}` : `${c.dim}${disabledLabel}${c.reset}`}
  ${c.bold}Voice:${c.reset}         ${voiceEnabled === 'true' ? `${c.green}${enabledLabel}${c.reset}` : `${c.dim}${disabledLabel}${c.reset}`}
  ${c.bold}Web search:${c.reset}    ${webSearchEnabled === 'true' ? `${c.green}${enabledLabel}${c.reset}` : `${c.dim}${disabledLabel}${c.reset}`}
`);

  const confirmChoice = await selectMenu(t(language, 'reviewConfirm'), [
    { label: t(language, 'yes'), value: 'confirm' },
    { label: t(language, 'reviewStartOver'), value: 'restart' },
  ], language);

  if (confirmChoice.value === 'restart') {
    return collectConfig(existingEnv);
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
    telegramAutoPair: 'true',
    voiceEnabled,
    groqApiKey,
    webSearchEnabled,
    braveApiKey,
    gatewayToken: existingEnv.GATEWAY_TOKEN || generateGatewayToken(),
  };
}

// Migrate state from old ZeroClaw to new OpenClaw state directory.
// Handles two cases:
//   1. Bind-mount dir: ~/.limbo/zeroclaw-state/ → ~/.limbo/openclaw-state/
//   2. Named Docker volume: limbo-zeroclaw-state → ~/.limbo/openclaw-state/
// Only runs if openclaw-state/ is empty. Preserves the old data (copy, not move).
// Legacy migration — can be removed once all production instances have migrated.
function migrateLegacyState() {
  // Skip if bind-mount dir already has content
  try {
    const entries = fs.readdirSync(OPENCLAW_STATE_DIR);
    if (entries.length > 0) return;
  } catch { return; }

  // Case 1: bind-mount directory on disk (newer installs used this)
  const legacyDir = path.join(LIMBO_DIR, 'zeroclaw-state');
  try {
    const legacyEntries = fs.readdirSync(legacyDir);
    if (legacyEntries.length > 0) {
      log(`Migrating state from ${legacyDir} to ${OPENCLAW_STATE_DIR} ...`);
      fs.cpSync(legacyDir, OPENCLAW_STATE_DIR, { recursive: true });
      log('Migration complete. Old directory preserved at: ' + legacyDir);
      return;
    }
  } catch { /* dir doesn't exist — try Docker volume next */ }

  // Case 2: named Docker volume (older installs used this)
  const candidateVolumes = ['limbo_limbo-zeroclaw-state', 'limbo-zeroclaw-state'];
  let foundVolume = null;
  try {
    const result = spawnSync('docker', ['volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8', stdio: 'pipe' });
    if (result.status === 0) {
      const existing = result.stdout.split('\n').map(s => s.trim());
      foundVolume = candidateVolumes.find(v => existing.includes(v)) || null;
    }
  } catch { /* docker not available yet */ }

  if (!foundVolume) return;

  log(`Migrating legacy state from volume "${foundVolume}" to ${OPENCLAW_STATE_DIR} ...`);
  const migrate = spawnSync('docker', [
    'run', '--rm',
    '-v', `${foundVolume}:/src:ro`,
    '-v', `${OPENCLAW_STATE_DIR}:/dst`,
    'alpine',
    'sh', '-c', 'cp -a /src/. /dst/',
  ], { stdio: 'pipe' });

  if (migrate.status === 0) {
    log('Migration complete. Old volume data is preserved and can be removed with: docker volume rm ' + foundVolume);
  } else {
    warn('Migration from old volume failed — continuing with empty state. Run `limbo start` again after verifying Docker is available.');
  }
}

// Migrate tokens from legacy file-based secret stores into the .env.
//
// Pre-consolidation releases of Limbo stored tokens in three separate paths:
//   1. ~/.limbo/secrets/              — written by the CLI (host), mounted as /run/secrets
//   2. ~/.limbo/zeroclaw-state/secrets/ — pre-2026-03 ZeroClaw legacy path
//   3. ~/.limbo/openclaw-state/secrets/ — written by the setup-server (container)
//
// After consolidation there is a single source of truth (the .env). This
// function runs on every `limbo start` / `update` but short-circuits via a
// marker file (~/.limbo/.secrets-migrated) after the first successful pass.
// Per-file, per-key it:
//   - looks up each secret in the legacy paths in priority order (1 > 3 > 2)
//   - does NOT overwrite a value that already exists in .env
//   - creates a backup .env.bak before writing, same as writeEnv
//
// TODO(2026-08-01): once production instances have all rolled through at
// least one release with this helper, delete the helper entirely and remove
// the marker file. Track in the release that drops this.
const SECRETS_MIGRATED_MARKER = path.join(LIMBO_DIR, '.secrets-migrated');

function migrateLegacySecretsToEnv() {
  if (fs.existsSync(SECRETS_MIGRATED_MARKER)) return;

  const SECRET_TO_ENV = {
    llm_api_key: 'LLM_API_KEY',
    telegram_bot_token: 'TELEGRAM_BOT_TOKEN',
    telegram_chat_id: 'TELEGRAM_CHAT_ID',
    gateway_token: 'GATEWAY_TOKEN',
    groq_api_key: 'GROQ_API_KEY',
    brave_api_key: 'BRAVE_API_KEY',
    google_client_id: 'GOOGLE_CLIENT_ID',
    google_client_secret: 'GOOGLE_CLIENT_SECRET',
  };
  // Priority order: newer paths win over older ones. The openclaw-state path
  // was written by setup-server inside the container, the top-level secrets/
  // by the host CLI — either can be present. zeroclaw-state is strictly
  // older (pre-OpenClaw).
  const legacyDirs = [
    path.join(LIMBO_DIR, 'secrets'),
    path.join(LIMBO_DIR, 'openclaw-state', 'secrets'),
    path.join(LIMBO_DIR, 'zeroclaw-state', 'secrets'),
  ];

  const existingEnv = parseEnvFile();
  let changed = false;

  for (const [secretName, envKey] of Object.entries(SECRET_TO_ENV)) {
    if (existingEnv[envKey]) continue; // don't overwrite
    for (const dir of legacyDirs) {
      const fp = path.join(dir, secretName);
      try {
        const value = fs.readFileSync(fp, 'utf8').trim();
        if (value) {
          existingEnv[envKey] = value;
          changed = true;
          break;
        }
      } catch { /* file doesn't exist or unreadable — try next */ }
    }
  }

  if (!changed) {
    // Nothing to migrate on this host — drop the marker anyway so the next
    // start skips the whole scan.
    try { fs.writeFileSync(SECRETS_MIGRATED_MARKER, new Date().toISOString()); } catch { /* best effort */ }
    return;
  }

  const content = Object.entries(existingEnv)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  safeWriteEnvFile(content);
  try { fs.writeFileSync(SECRETS_MIGRATED_MARKER, new Date().toISOString()); } catch { /* best effort */ }
  log('Migrated legacy secrets into .env');
}

function ensureComposeFile(hardened = false) {
  fs.mkdirSync(LIMBO_DIR, { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, 'maps'), { recursive: true });
  fs.mkdirSync(OPENCLAW_STATE_DIR, { recursive: true });
  fs.mkdirSync(FLAGS_DIR, { recursive: true });
  migrateLegacyState();
  // CONFIG_DIR is bind-mounted into the container (uid 999) as /data/config/.
  // The container needs to write setup_token in here during first-run wizard,
  // and host user owns the dir, so it must be world-writable (0777). ~/.limbo/
  // lives under the user's home, so the permissive subdirectory does not expose
  // anything beyond what the home root already permits.
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o777 });
  try { fs.chmodSync(CONFIG_DIR, 0o777); } catch { /* best effort on existing dirs */ }
  // Migrate legacy .env from LIMBO_DIR root to config/ subdir
  const legacyEnv = path.join(LIMBO_DIR, '.env');
  if (legacyEnv !== ENV_FILE && fs.existsSync(legacyEnv) && !fs.existsSync(ENV_FILE)) {
    fs.renameSync(legacyEnv, ENV_FILE);
  }
  if (!fs.existsSync(ENV_FILE)) safeWriteEnvFile('');
  // Migrate tokens from legacy secret files (~/.limbo/secrets/ and
  // ~/.limbo/zeroclaw-state/secrets/) into the .env — idempotent per-file.
  migrateLegacySecretsToEnv();
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
  fs.writeFileSync(COMPOSE_FILE, hardened ? composeContentHardened() : composeContent());
}

function ensureGatewayToken(existingEnv) {
  if (existingEnv.GATEWAY_TOKEN) return existingEnv.GATEWAY_TOKEN;
  const token = generateGatewayToken();
  existingEnv.GATEWAY_TOKEN = token;
  writeEnv({ keepExisting: true, gatewayToken: token }, existingEnv);
  return token;
}

function pullOrBuildImage(lang) {
  // --image or LIMBO_IMAGE: user provided a pre-built image, skip build/pull entirely.
  if (IMAGE_OVERRIDE || parseFlag('--image')) {
    const img = resolveImage();
    ok(`Using image: ${img}`);
    return;
  }

  // When running from the repo (npx .), prefer local build over registry pull.
  const repoDockerfile = path.join(__dirname, 'Dockerfile');
  if (fs.existsSync(repoDockerfile)) {
    header(t(lang, 'buildingFallback'));
    execSync(`docker build -t ${REGISTRY_IMAGE}:${DEFAULT_TAG} .`, { stdio: 'inherit', cwd: __dirname });
    ok(t(lang, 'buildOk', DEFAULT_TAG));
    return;
  }

  header(t(lang, 'pullingImage'));
  try {
    run('docker compose pull -q');
    ok(t(lang, 'imagePulled'));
  } catch {
    die('Could not pull image and no local Dockerfile found. Check your network or registry access.');
  }
}

// Fix volume ownership before any docker compose run commands.
// cap_drop:ALL strips CAP_DAC_OVERRIDE from root, so a root-user container
// cannot write to limbo-owned volumes.  This one-shot container runs as root
// with the minimum caps needed to chown the volume dirs back to limbo.
function ensureVolumePermissions() {
  runDockerCompose([
    'run', '--rm', '--no-deps',
    '--user', 'root',
    '--cap-add', 'DAC_OVERRIDE',
    '--entrypoint', 'sh',
    'limbo',
    '-c', 'chown -R limbo:limbo /data /home/limbo/.openclaw 2>/dev/null; true',
  ], { stdio: 'pipe' });
}

// Install SIGINT / SIGTERM handlers that cancel an in-flight wizard session
// on the container before this process exits. Without this, killing the
// CLI (Ctrl+C, shell exit, etc.) leaves an orphan setup-server child
// running inside the container — LIMBO_PORT+1 stays bound, and the next
// wizard attempt collides on the port. Returns an `uninstall` function the
// caller must run on graceful completion so we do not double-cancel.
//
// The handler is intentionally synchronous-ish: Node gives us a few
// hundred ms between a signal and process death, so the best we can do is
// fire the DELETE request and hope it reaches the container. The CLI exit
// Request a wizard session, auto-cancelling any stale/active session first.
// Returns the new session object on success, or calls die() on failure.
async function requestWizardWithAutoCancel(client, feature, timeoutMs) {
  try {
    return await client.requestWizard({ feature, timeoutMs });
  } catch (err) {
    if (err.status === 409 && err.body && err.body.activeSessionId) {
      // Cancel the stale session and retry once.
      try {
        await client.cancelWizard(err.body.activeSessionId);
      } catch { /* already gone — fine */ }
      try {
        return await client.requestWizard({ feature, timeoutMs });
      } catch (retryErr) {
        die(`Wizard request failed after cancelling stale session: ${retryErr.message}`);
      }
    }
    die(`Wizard request failed (status ${err.status || '?'}): ${err.message}`);
  }
}

// does not wait on it, but the supervisor's DELETE path is O(ms) on
// localhost so the vast majority of signals land before process teardown.
function installWizardCleanupHandlers(client, session) {
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // Fire-and-forget — we have at most ~100ms before Node kills us.
    // The DELETE is idempotent on the supervisor side (already-terminal
    // sessions just return 404, which we ignore).
    try {
      client.cancelWizard(session.id).catch(() => {});
    } catch { /* ignore */ }
  };

  const onExit = (signal) => {
    cancel();
    // Re-raise the default action so the shell sees the usual exit code.
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const sigintHandler = () => onExit('SIGINT');
  const sigtermHandler = () => onExit('SIGTERM');
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigtermHandler);

  return {
    uninstall() {
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigtermHandler);
    },
    cancel,
  };
}

// Read a single env var from ~/.limbo/.env
function loadEnvVar(name) {
  try {
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    const match = content.match(new RegExp('^' + name + '=(.+)$', 'm'));
    return match ? match[1].trim() : null;
  } catch { return null; }
}

// Append or update env vars in ~/.limbo/.env without overwriting existing ones
function persistEnvVars(vars) {
  try {
    let content = '';
    try { content = fs.readFileSync(ENV_FILE, 'utf8'); } catch {}
    for (const [key, value] of Object.entries(vars)) {
      const re = new RegExp('^' + key + '=.*$', 'm');
      if (re.test(content)) {
        content = content.replace(re, key + '=' + value);
      } else {
        content = content.trimEnd() + '\n' + key + '=' + value + '\n';
      }
    }
    safeWriteEnvFile(content);
  } catch {}
}

function installGlobalAlias() {
  // Create a `limbo` shell wrapper so users don't have to type `npx limbo-ai` every time.
  // Tries /usr/local/bin first (macOS, Linux with sudo), falls back to ~/.local/bin (no sudo).
  const wrapper = '#!/bin/sh\nexec npx limbo-ai@latest "$@"\n';
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'limbo'),
    '/usr/local/bin/limbo',
  ];

  for (const target of candidates) {
    try {
      // Skip if already installed and current (must include @latest)
      if (fs.existsSync(target)) {
        const existing = fs.readFileSync(target, 'utf8');
        if (existing.includes('limbo-ai@latest')) return;
      }
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, wrapper, { mode: 0o755 });
      log(`Installed ${c.bold}limbo${c.reset} command → ${target}`);
      return;
    } catch {
      // Permission denied — try next candidate
    }
  }
  // Silent failure — not critical, user can still use npx limbo-ai
}


function countRunningLimboContainers() {
  try {
    const result = spawnSync('docker', ['compose', 'ps', '-q', '--status', 'running'], {
      cwd: LIMBO_DIR, stdio: 'pipe', encoding: 'utf8',
    });
    if (result.status !== 0 || !result.stdout) return 0;
    return result.stdout.trim().split('\n').filter(Boolean).length;
  } catch { return 0; }
}

function stopExistingContainers(lang) {
  const running = countRunningLimboContainers();
  if (running > 0) {
    warn(t(lang, 'staleContainersFound', running));
    runDockerCompose(['down', '--remove-orphans'], { stdio: 'pipe' });
    ok(t(lang, 'staleContainersStopped'));
  }
  return running;
}


// ─── Native OAuth (PKCE) for OpenAI Codex ───────────────────────────────────
// Implements the full OAuth flow locally so we never need an interactive TUI.

const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access',
};

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildOAuthUrl(pkce, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_OAUTH.clientId,
    redirect_uri: OPENAI_OAUTH.redirectUri,
    scope: OPENAI_OAUTH.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'pi',
  });
  return `${OPENAI_OAUTH.authorizeUrl}?${params}`;
}

function parseCallbackInput(input) {
  const trimmed = input.trim();
  // Accept full URL, just the code, or code#state / code=XXX&state=YYY
  try {
    const url = new URL(trimmed);
    return {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
    };
  } catch {}
  // Try as query string
  if (trimmed.includes('code=')) {
    const params = new URLSearchParams(trimmed.replace(/^\?/, ''));
    return { code: params.get('code'), state: params.get('state') };
  }
  // Bare code
  return { code: trimmed, state: null };
}

async function exchangeCodeForTokens(code, pkceVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OPENAI_OAUTH.clientId,
    code,
    code_verifier: pkceVerifier,
    redirect_uri: OPENAI_OAUTH.redirectUri,
  });
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
}

function writeAuthProfilesToDocker(store) {
  const json = JSON.stringify(store, null, 2);
  const destDir = '/home/limbo/.openclaw';
  const destFile = `${destDir}/auth-profiles.json`;
  spawnSync('docker', [
    'compose', 'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'limbo',
    '-c', `mkdir -p "${destDir}" && cat > "${destFile}"`,
  ], {
    cwd: LIMBO_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: json,
    encoding: 'utf8',
  });
}

// OpenClaw auth-profiles format — must match setup-server/server.js
function buildCodexAuthProfile(profile) {
  const profileName = profile.email || 'default';
  const profileId = `openai-codex:${profileName}`;
  return {
    version: 1,
    profiles: {
      [profileId]: {
        type: 'oauth',
        provider: 'openai-codex',
        access: profile.access,
        refresh: profile.refresh,
        expires: profile.expires,
        email: profile.email || '',
        accountId: profile.accountId || '',
      },
    },
  };
}

function buildAnthropicAuthProfile(token) {
  return {
    version: 1,
    profiles: {
      'anthropic:default': {
        type: 'token',
        provider: 'anthropic',
        token,
      },
    },
  };
}

function parseClaudeSetupToken(raw) {
  const trimmed = raw.trim();
  if (/^sk-ant-[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

async function runClaudeSetupTokenAuth(language) {
  const tokenRaw = await promptValidated(
    t(language, 'claudeTokenPrompt'),
    (value) => {
      if (!value) return { ok: false, message: t(language, 'requiredField') };
      const parsed = parseClaudeSetupToken(value);
      if (!parsed) return { ok: false, message: t(language, 'claudeTokenInvalid') };
      return { ok: true, value };
    },
  );

  const token = parseClaudeSetupToken(tokenRaw);
  const store = buildAnthropicAuthProfile(token);
  writeAuthProfilesToDocker(store);
  ok(t(language, 'claudeTokenWritten'));
  return 0;
}

async function runCodexOAuth(language) {
  const pkce = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = buildOAuthUrl(pkce, state);

  // Open browser automatically
  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { execSync(`${openCmd} "${authUrl}"`, { stdio: 'ignore' }); } catch {}

  console.log(`\n  ${c.cyan}${c.bold}→  ${authUrl}${c.reset}\n`);
  log(t(language, 'oauthPasteHint'));

  const callbackRaw = await promptValidated(
    t(language, 'oauthCallbackPrompt'),
    (value) => {
      if (!value) return { ok: false, message: t(language, 'requiredField') };
      const parsed = parseCallbackInput(value);
      if (!parsed.code) return { ok: false, message: t(language, 'oauthInvalidCallback') };
      return { ok: true, value };
    },
  );

  const { code, state: returnedState } = parseCallbackInput(callbackRaw);
  if (returnedState && returnedState !== state) {
    warn(t(language, 'oauthStateMismatch'));
  }

  log(t(language, 'oauthExchanging'));
  const tokens = await exchangeCodeForTokens(code, pkce.verifier);

  // Extract account info from JWT
  const jwt = decodeJwtPayload(tokens.access_token);
  const authClaim = jwt['https://api.openai.com/auth'] || {};
  const accountId = authClaim.chatgpt_account_id || '';
  const email = jwt.email || '';

  const store = buildCodexAuthProfile({
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in * 1000),
    accountId,
    email,
  });
  writeAuthProfilesToDocker(store);

  return 0;
}

// ─── Subscription auth flow ──────────────────────────────────────────────────

async function runSubscriptionAuthFlow(cfg) {
  header(t(cfg.language, 'subscriptionSetup'));

  if (cfg.providerFamily === 'openai') {
    log(t(cfg.language, 'openaiSubscriptionIntro'));
    log(t(cfg.language, 'authFlowStart'));
    try {
      await runCodexOAuth(cfg.language);
    } catch (err) {
      die(`${t(cfg.language, 'authFlowFailed')}: ${err.message}`);
    }
    // Native OAuth — tokens verified by successful exchange, no status check needed
    ok(t(cfg.language, 'authFlowDone'));
  } else {
    log(t(cfg.language, 'anthropicSubscriptionIntro'));
    log(t(cfg.language, 'authFlowStart'));
    try {
      await runClaudeSetupTokenAuth(cfg.language);
    } catch (err) {
      die(`${t(cfg.language, 'authFlowFailed')}: ${err.message}`);
    }
    ok(t(cfg.language, 'authFlowDone'));
  }
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

// ─── Docker auto-install ──────────────────────────────────────────────────────

function installDocker() {
  const platform = os.platform();
  if (platform === 'linux') {
    header('Installing Docker...');
    try {
      execSync('curl -fsSL https://get.docker.com | sh', { stdio: 'inherit' });
      ok('Docker installed.');
    } catch {
      die('Failed to install Docker. Install it manually: https://docs.docker.com/get-docker/');
    }
  } else if (platform === 'darwin') {
    die(`Docker is required but not installed.

  Install Docker Desktop for Mac:
  ${c.cyan}https://docs.docker.com/desktop/install/mac-install/${c.reset}

  Then run ${c.bold}npx limbo-ai${c.reset} again.`);
  } else {
    die('Docker is required but not installed. See https://docs.docker.com/get-docker/');
  }
}

function extractWizardUrl(maxWaitSecs = 30) {
  const deadline = Date.now() + maxWaitSecs * 1000;
  while (Date.now() < deadline) {
    try {
      const logs = runDockerCompose(['logs', '--no-log-prefix'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      const output = logs.stdout || '';
      const match = output.match(/SETUP_URL=(https?:\/\/\S+)/);
      if (match) { spinnerClear(); return match[1]; }
    } catch {}
    spinnerWrite('Starting...');
    sleep(500);
  }
  spinnerClear();
  return null;
}

function printWizardUrl(url) {
  const isSSH = !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT);

  console.log(`
${c.green}${c.bold}╔════════════════════════════════════════════════════════╗${c.reset}
${c.green}${c.bold}║            Setup wizard is ready!                      ║${c.reset}
${c.green}${c.bold}╚════════════════════════════════════════════════════════╝${c.reset}

  Open this URL to complete setup:
  ${c.cyan}${c.bold}${url}${c.reset}
`);

  if (!process.env.LIMBO_PUBLIC_URL && isSSH) {
    console.log(`  If you're on a remote server, forward this port:
    ${c.dim}ssh -L ${PORT}:localhost:${PORT} user@your-server${c.reset}
`);
  }

  console.log(`  The wizard will guide you through provider, API key, and model selection.
  Once complete, Limbo will restart and be ready to use.

  ${c.dim}Logs: limbo logs | Stop: limbo stop${c.reset}
`);
  // Auto-open on macOS (only when running locally)
  if (os.platform() === 'darwin' && !isSSH) {
    try { execSync(`open "${url}"`, { stdio: 'pipe' }); } catch {}
  }
}

function writeMinimalEnv() {
  ensureComposeFile(false);
  // Merge into the existing .env rather than clobbering it. ensureComposeFile()
  // above just ran migrateLegacySecretsToEnv(), which may have populated
  // LLM_API_KEY, TELEGRAM_BOT_TOKEN, etc. Wiping those would force the user
  // to re-enter every secret in the wizard.
  const existingEnv = parseEnvFile();
  const gatewayToken = existingEnv.GATEWAY_TOKEN || generateGatewayToken();
  const merged = {
    ...existingEnv,
    CLI_LANGUAGE: existingEnv.CLI_LANGUAGE || 'en',
    LIMBO_PORT: String(PORT),
    GATEWAY_TOKEN: gatewayToken,
  };
  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  safeWriteEnvFile(content);
  return gatewayToken;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStart() {
  // ── Auto-install Docker if missing ────────────────────────────────────────
  if (!hasDocker()) {
    installDocker();
    // Verify it worked
    if (!hasDocker()) die(t('en', 'dockerMissing'));
  }

  const hardened = process.argv.includes('--hardened');
  const cliMode = process.argv.includes('--cli');
  const reconfig = process.argv.includes('--reconfigure');

  // ── Detect existing instance / port selection ──────────────────────────────
  const existingEnv = parseEnvFile();
  const alreadyHasEnv = fs.existsSync(ENV_FILE);
  const hasProviderConfig = alreadyHasEnv && existingEnv.MODEL_PROVIDER;

  if (existingEnv.LIMBO_PORT) {
    const parsed = parseInt(existingEnv.LIMBO_PORT, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      warn(`Invalid LIMBO_PORT="${existingEnv.LIMBO_PORT}" in .env, using default ${DEFAULT_PORT}`);
    } else {
      PORT = parsed;
    }
  } else {
    const existing = detectPortConflict();
    if (existing) {
      console.log(`
  ${c.yellow}${c.bold}Existing instance detected${c.reset}
  ${c.dim}Port ${existing.port} is in use (${existing.processInfo})${c.reset}

  Limbo will run its own instance on port ${c.bold}${COEXIST_PORT}${c.reset}.
  Both can coexist safely — separate containers, separate data.
`);
      PORT = COEXIST_PORT;
    }
  }

  ensureComposeFile(hardened);

  // ── Route: Headless (--provider flag) ─────────────────────────────────────
  const flagProvider = parseFlag('--provider');
  const flagApiKey = parseFlag('--api-key');
  const flagModel = parseFlag('--model');
  const flagLang = parseFlag('--language') || 'en';
  if (flagProvider) {
    const validProviders = ['openai', 'anthropic', 'openrouter'];
    if (!validProviders.includes(flagProvider)) {
      die(t(flagLang, 'headlessInvalidProvider'));
    }
    if (!flagApiKey) {
      die(t(flagLang, 'headlessMissingApiKey'));
    }

    const lang = flagLang;
    const providerFamily = deriveProviderFamily(flagProvider);
    const catalog = getModelCatalog(providerFamily, 'api-key');
    const modelName = flagModel || catalog.defaultModel;

    log(t(lang, 'headlessStarting'));
    const cfg = {
      language: lang,
      authMode: 'api-key',
      provider: catalog.provider,
      providerFamily,
      modelName,
      apiKey: flagApiKey,
      telegramEnabled: 'false',
      telegramToken: '',
      telegramAutoPair: 'false',
      gatewayToken: ensureGatewayToken(existingEnv),
    };
    writeEnv({ ...cfg, CLI_LANGUAGE: cfg.language }, existingEnv);
    ok(t(cfg.language, 'envWritten'));
    return startContainerWithConfig(cfg, existingEnv, alreadyHasEnv);
  }

  // ── Route: Existing config, no reconfigure ────────────────────────────────
  if (hasProviderConfig && !reconfig) {
    const lang = existingEnv.CLI_LANGUAGE || 'en';
    log(t(lang, 'foundExistingConfig'));
    log(t(lang, 'reconfigureHint'));
    ensureGatewayToken(existingEnv);
    const cfg = {
      language: lang,
      provider: existingEnv.MODEL_PROVIDER || 'anthropic',
      providerFamily: deriveProviderFamily(existingEnv.MODEL_PROVIDER),
      authMode: existingEnv.AUTH_MODE || 'api-key',
      modelName: existingEnv.MODEL_NAME || 'claude-opus-4-6',
      telegramEnabled: existingEnv.TELEGRAM_ENABLED || 'false',
    };
    return startContainerWithConfig(cfg, existingEnv, alreadyHasEnv);
  }

  // ── Route: CLI prompts (--cli flag or --reconfigure --cli) ────────────────
  if (cliMode) {
    const lang = existingEnv.CLI_LANGUAGE || 'en';
    header(reconfig ? t(lang, 'reconfiguration') : t('en', 'configuration'));
    const cfg = await collectConfig(existingEnv);
    writeEnv({ ...cfg, CLI_LANGUAGE: cfg.language }, existingEnv);
    ok(t(cfg.language, 'envWritten'));
    return startContainerWithConfig(cfg, existingEnv, alreadyHasEnv);
  }

  // ── Route: Wizard reconfigure or fresh install ─────────────────────────────
  // For --reconfigure: always write FORCE_SETUP_MODE so the entrypoint clears
  // internal config. The host .env may not have MODEL_PROVIDER (wizard-configured
  // users store config only inside the Docker volume), so we can't gate on
  // hasProviderConfig — the user explicitly asked to reconfigure.
  if (reconfig) {
    log('Resetting configuration for setup wizard...');
    const minimalContent = `CLI_LANGUAGE=${existingEnv.CLI_LANGUAGE || 'en'}\nLIMBO_PORT=${PORT}\nFORCE_SETUP_MODE=true\n`;
    safeWriteEnvFile(minimalContent);
    ensureGatewayToken(existingEnv);
  }

  log('Starting Limbo with setup wizard...');
  if (!alreadyHasEnv && !reconfig) {
    writeMinimalEnv();
  }

  pullOrBuildImage('en');
  ensureVolumePermissions();

  header('Starting Limbo...');
  // Force recreate so the container picks up the clean .env (enters setup mode)
  const upResult = runDockerCompose(['up', '-d', '--remove-orphans', '--force-recreate'], { stdio: 'pipe' });
  if (upResult.status !== 0) {
    process.stderr.write(upResult.stderr || '');
    die('Container failed to start. Run `limbo logs` to investigate.');
  }

  // Extract wizard URL from container logs (polls briefly, no healthcheck needed)
  // In cloud mode, setup-server logs SETUP_URL=https://<public>/?token=... so
  // extractWizardUrl() already returns the correct public URL.
  const wizardUrl = extractWizardUrl();
  const displayUrl = wizardUrl || `http://127.0.0.1:${PORT}`;
  if (!wizardUrl) {
    warn('Could not extract setup token from container logs. The wizard may need a moment to start.');
    warn(`If the URL below doesn't work, try: ${c.cyan}limbo logs${c.reset} to check container status.`);
  }
  printWizardUrl(displayUrl);

  // Remove FORCE_SETUP_MODE from .env so the container doesn't re-enter setup
  // mode on restart after the wizard completes. The entrypoint uses a marker
  // file as a safety net, but cleaning the env is the primary mechanism.
  try {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const cleaned = envContent.replace(/^FORCE_SETUP_MODE=.*\n?/m, '');
    if (cleaned !== envContent) safeWriteEnvFile(cleaned);
  } catch {}
}

// Shared path for headless, CLI-prompt, and existing-config routes
async function startContainerWithConfig(cfg, existingEnv, alreadyHasEnv) {
  const mergedEnv = parseEnvFile();
  if (!cfg.language) cfg.language = mergedEnv.CLI_LANGUAGE || 'en';
  if (!mergedEnv.CLI_LANGUAGE) {
    writeEnv({ ...cfg, keepExisting: true, CLI_LANGUAGE: cfg.language }, mergedEnv);
  }

  pullOrBuildImage(cfg.language);
  ensureVolumePermissions();

  if (cfg.authMode === 'subscription' && (process.argv.includes('--reconfigure') || !alreadyHasEnv)) {
    await runSubscriptionAuthFlow(cfg);
  }

  header(t(cfg.language, 'starting'));
  const upResult = runDockerCompose(['up', '-d', '--remove-orphans'], { stdio: 'pipe' });
  if (upResult.status !== 0) {
    process.stderr.write(upResult.stderr || '');
    die('Container failed to start. Run `limbo logs` to investigate.');
  }
  ok(t(cfg.language, 'healthy'));

  console.log(`\n  ${c.yellow}⚠  ${t(cfg.language, 'securityNotice')}${c.reset}\n`);

  installGlobalAlias();

  printSuccess({
    language: cfg.language,
    telegramEnabled: mergedEnv.TELEGRAM_ENABLED || cfg.telegramEnabled || 'false',
  }, mergedEnv.GATEWAY_TOKEN || parseEnvFile().GATEWAY_TOKEN);
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

// Build the npm install -g command, prefixing with sudo when the global
// node_modules directory is not writable by the current user (common when
// the original install was done with sudo on Linux).
function npmGlobalInstallCmd(pkg) {
  try {
    const globalDir = execSync('npm prefix -g', { encoding: 'utf8', timeout: 5000 }).trim();
    const modulesDir = path.join(globalDir, 'lib', 'node_modules');
    fs.accessSync(modulesDir, fs.constants.W_OK);
    return `npm install -g ${pkg}`;
  } catch {
    return `sudo npm install -g ${pkg}`;
  }
}

// Returns true if the CLI was updated on disk (caller should re-exec).
function selfUpdateCli() {
  const pkg = require('./package.json');
  try {
    const latest = execSync('npm view limbo-ai version', { encoding: 'utf8', timeout: 10000 }).trim();
    if (!latest || latest === pkg.version) return false;
    const cur = pkg.version.split('.').map(Number);
    const lat = latest.split('.').map(Number);
    const isNewer = lat[0] > cur[0] || (lat[0] === cur[0] && lat[1] > cur[1]) ||
      (lat[0] === cur[0] && lat[1] === cur[1] && lat[2] > cur[2]);
    if (!isNewer) return false;

    const isGlobal = !process.argv[1].includes('npx') && !process.argv[1].includes('node_modules/.cache');

    if (isGlobal) {
      log(`Updating CLI: ${pkg.version} → ${latest}...`);
      execSync(npmGlobalInstallCmd('limbo-ai@latest'), { stdio: 'inherit' });
      ok(`CLI updated to ${latest}.`);
      try { fs.unlinkSync(UPDATE_CHECK_FILE); } catch {}
      return true;
    } else {
      warn(`CLI is outdated (${pkg.version} → ${latest}). npx served a cached version.`);
      try {
        const npxCacheBase = path.join(os.homedir(), '.npm', '_npx');
        if (fs.existsSync(npxCacheBase)) {
          for (const entry of fs.readdirSync(npxCacheBase)) {
            const pkgPath = path.join(npxCacheBase, entry, 'node_modules', 'limbo-ai');
            if (fs.existsSync(pkgPath)) {
              fs.rmSync(path.join(npxCacheBase, entry), { recursive: true, force: true });
              log('Cleared stale npx cache.');
              break;
            }
          }
        }
      } catch {}
      log(`Re-run: ${c.cyan}npx limbo-ai@latest update${c.reset}`);
      return false;
    }
  } catch {
    warn('Could not check for CLI updates. Run: npm install -g limbo-ai@latest');
    return false;
  }
}

function cmdUpdate() {
  if (!fs.existsSync(COMPOSE_FILE)) die(t('en', 'installMissing'));

  // Always attempt CLI self-update, regardless of install method.
  // If updated, re-exec so the new code (with possibly a new default registry) runs.
  const cliWasUpdated = selfUpdateCli();
  if (cliWasUpdated) {
    log('Re-executing with updated CLI...');
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
    return;
  }

  // Restore PORT from existing .env so the regenerated compose uses the right port.
  const existingEnv = parseEnvFile();
  if (existingEnv.LIMBO_PORT) {
    const parsed = parseInt(existingEnv.LIMBO_PORT, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) PORT = parsed;
  }

  // Regenerate compose file from current template. This handles:
  //   - ZeroClaw → OpenClaw migration (volume mounts, healthcheck)
  //   - Image registry/tag updates
  //   - Any new compose changes shipped with the CLI
  // Detect hardened mode from existing compose (squid sidecar present).
  const existingCompose = fs.readFileSync(COMPOSE_FILE, 'utf8');
  const hardened = existingCompose.includes('squid:');
  ensureComposeFile(hardened);

  log('Pulling latest image...');
  run(`docker compose -f "${COMPOSE_FILE}" pull -q`);

  // ── Version parity check ──────────────────────────────────────────────
  // The CLI and Docker image MUST be the same version. If selfUpdateCli
  // failed (network, timeout killed by an older CLI, npm error) but the
  // image was updated, the compose template from the old CLI is wrong for
  // the new image. Detect the mismatch and force a CLI update + re-exec.
  const cliVersion = require('./package.json').version;
  try {
    const imageVersion = execSync(
      `docker compose -f "${COMPOSE_FILE}" run --rm --no-deps --entrypoint node limbo -e "process.stdout.write(require('/app/package.json').version)"`,
      { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (imageVersion && imageVersion !== cliVersion) {
      warn(`CLI (${cliVersion}) ≠ image (${imageVersion}) — updating CLI to match...`);
      try {
        execSync(npmGlobalInstallCmd('limbo-ai@latest'), { stdio: 'inherit' });
        log('Re-executing with matched CLI...');
        const { execFileSync } = require('child_process');
        execFileSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
        return;
      } catch {
        warn('Could not update CLI. Continuing with current version.');
      }
    }
  } catch {
    // Can't check image version (image not pulled yet, etc.) — continue.
  }

  log('Restarting...');
  run(`docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans`);

  // Clear update-check cache so the banner doesn't persist after a successful update
  try { fs.unlinkSync(UPDATE_CHECK_FILE); } catch {}

  ok('Updated and restarted.');
}

function cmdStatus() {
  if (!fs.existsSync(COMPOSE_FILE)) {
    log('Limbo is not installed.');
    return;
  }
  run('docker compose ps');
}

function cmdConfig() {
  const args = process.argv.slice(3);
  const feature = args[0];

  if (!feature || !['voice', 'web-search'].includes(feature)) {
    console.log(`
${c.bold}Usage:${c.reset}
  limbo config voice --enable --api-key <key>
  limbo config voice --disable
  limbo config voice --status
  limbo config web-search --enable --api-key <key>
  limbo config web-search --disable
  limbo config web-search --status
`);
    return;
  }

  if (!fs.existsSync(ENV_FILE)) {
    die('Limbo is not configured. Run "limbo start" first.');
  }

  const existingEnv = {};
  const envContent = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) existingEnv[match[1]] = match[2].replace(/^"|"$/g, '');
  }

  const isVoice = feature === 'voice';
  const envKey = isVoice ? 'VOICE_ENABLED' : 'WEB_SEARCH_ENABLED';
  const apiKeyEnvKey = isVoice ? 'GROQ_API_KEY' : 'BRAVE_API_KEY';
  const featureLabel = isVoice ? 'Voice transcription' : 'Web search';

  const hasEnable = args.includes('--enable');
  const hasDisable = args.includes('--disable');
  const hasStatus = args.includes('--status');
  const apiKeyIdx = args.indexOf('--api-key');
  const apiKey = apiKeyIdx !== -1 ? args[apiKeyIdx + 1] : null;

  if (hasStatus) {
    const enabled = existingEnv[envKey] === 'true';
    const key = existingEnv[apiKeyEnvKey] || '';
    console.log(`${featureLabel}: ${enabled ? `${c.green}enabled${c.reset}` : `${c.dim}disabled${c.reset}`}`);
    if (key) {
      const masked = key.length > 8 ? key.substring(0, 4) + '...' + key.slice(-4) : '***';
      console.log(`API Key: ${masked}`);
    }
    return;
  }

  if (!hasEnable && !hasDisable) {
    die('Specify --enable, --disable, or --status');
  }

  if (hasEnable) {
    if (apiKey) {
      if (isVoice && !apiKey.startsWith('gsk_')) {
        warn('Groq API keys typically start with gsk_');
      }
      if (!isVoice && !apiKey.startsWith('BSA')) {
        warn('Brave API keys typically start with BSA');
      }
      existingEnv[apiKeyEnvKey] = apiKey;
      ok(`${featureLabel} API key saved.`);
    } else {
      if (!existingEnv[apiKeyEnvKey]) {
        die(`No API key found. Use --api-key <key> to set one.`);
      }
    }
    existingEnv[envKey] = 'true';
  } else {
    existingEnv[envKey] = 'false';
  }

  const newContent = Object.entries(existingEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  safeWriteEnvFile(newContent);
  ok(`${featureLabel} ${hasEnable ? 'enabled' : 'disabled'}.`);

  if (fs.existsSync(COMPOSE_FILE)) {
    log('Restarting container...');
    try {
      execSync(`docker compose -f "${COMPOSE_FILE}" restart limbo`, { stdio: 'inherit' });
      ok('Container restarted.');
    } catch {
      warn('Could not restart container. Restart manually with: limbo stop && limbo start');
    }
  }
}

async function cmdSwitchBrain() {
  const existingEnv = parseEnvFile();
  if (!existingEnv.MODEL_PROVIDER) {
    die('No existing configuration found. Run `limbo start` first to set up.');
  }

  // Resolve port from existing config
  if (existingEnv.LIMBO_PORT) {
    const parsed = parseInt(existingEnv.LIMBO_PORT, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) PORT = parsed;
  }

  const lang = existingEnv.CLI_LANGUAGE || 'en';
  const currentProvider = existingEnv.MODEL_PROVIDER || 'unknown';
  const currentModel = existingEnv.MODEL_NAME || 'unknown';

  header(lang === 'es' ? 'Cambiar Proveedor' : 'Switch Provider');
  console.log(`  ${c.dim}${lang === 'es' ? 'Proveedor actual' : 'Current provider'}: ${c.reset}${c.bold}${currentProvider}${c.reset} (${currentModel})\n`);

  // ── New-world switch-brain flow ──────────────────────────────────────
  // Talks to the container's wizard supervisor over the TCP control plane
  // (127.0.0.1:${PORT+2}). No docker rebuild, no force-recreate, no
  // OpenClaw restart — the setup-server runs as a sibling process to
  // OpenClaw inside the container, and OpenClaw hot-reloads its config
  // from disk when the wizard writes the new MODEL_PROVIDER /
  // MODEL_NAME / LLM_API_KEY.
  const { createControlClient } = require('./lib/control-client');
  const controlPort = PORT + CONTROL_PORT_OFFSET;
  const client = createControlClient({ port: controlPort });

  try {
    await client.health();
  } catch (err) {
    die(
      `Supervisor not reachable at 127.0.0.1:${controlPort}.\n` +
      `Is the container running? Run 'limbo start' first.\n` +
      `(error: ${err.message})`
    );
  }

  log(lang === 'es' ? 'Solicitando wizard de cambio de proveedor...' : 'Requesting provider switch wizard session...');
  const session = await requestWizardWithAutoCancel(client, 'switch-brain', 15 * 60 * 1000);

  // Install SIGINT/SIGTERM handlers so Ctrl+C during the wizard cancels
  // the session on the supervisor and does not orphan the setup-server
  // child inside the container.
  const cleanup = installWizardCleanupHandlers(client, session);

  // The wizard listens on session.port (PORT + 1) inside the container,
  // exposed on the host via the compose port mapping.
  const wizardUrl = parseEnvFile().LIMBO_PUBLIC_URL
    ? `${parseEnvFile().LIMBO_PUBLIC_URL}/?token=${session.token}`
    : `http://127.0.0.1:${session.port}/?token=${session.token}`;

  printWizardUrl(wizardUrl);

  // Poll the supervisor until the wizard session reaches a terminal state.
  try {
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      let status;
      try {
        status = await client.getWizard(session.id);
      } catch (err) {
        // 404 after completion = session was reaped; treat as done.
        if (err.status === 404) {
          ok(lang === 'es' ? 'Proveedor actualizado.' : 'Provider updated.');
          return;
        }
        throw err;
      }
      if (status.status === 'done') {
        ok(lang === 'es' ? 'Proveedor actualizado.' : 'Provider updated.');
        return;
      }
      if (status.status === 'error') {
        die(`Wizard failed: ${status.error || 'unknown error'}`);
      }
      if (status.status === 'timeout') {
        die(lang === 'es' ? 'El wizard expiró.' : 'Wizard timed out.');
      }
      // still pending/ready/active → keep polling
    }
  } finally {
    cleanup.uninstall();
  }
}

async function cmdConnectCalendar() {
  const existingEnv = parseEnvFile();
  if (!existingEnv.MODEL_PROVIDER) {
    die('No existing configuration found. Run `limbo start` first to set up.');
  }

  if (existingEnv.GOOGLE_CALENDAR_ENABLED === 'true') {
    ok('Google Calendar is already connected.');
    return;
  }

  // Resolve port from existing config
  if (existingEnv.LIMBO_PORT) {
    const parsed = parseInt(existingEnv.LIMBO_PORT, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) PORT = parsed;
  }

  const lang = existingEnv.CLI_LANGUAGE || 'en';
  header(lang === 'es' ? 'Conectar Google Calendar' : 'Connect Google Calendar');

  // ── New-world connect-calendar flow ──────────────────────────────────
  // Talks to the container's wizard supervisor over the TCP control plane
  // (127.0.0.1:${PORT+2}). No docker rebuild, no force-recreate, no
  // OpenClaw restart — the setup-server runs as a sibling process to
  // OpenClaw inside the container, and OpenClaw hot-reloads its config
  // from disk when the wizard writes credentials.
  const { createControlClient } = require('./lib/control-client');
  const controlPort = PORT + CONTROL_PORT_OFFSET;
  const client = createControlClient({ port: controlPort });

  try {
    await client.health();
  } catch (err) {
    die(
      `Supervisor not reachable at 127.0.0.1:${controlPort}.\n` +
      `Is the container running? Run 'limbo start' first.\n` +
      `(error: ${err.message})`
    );
  }

  log(lang === 'es' ? 'Solicitando wizard de Google Calendar...' : 'Requesting Google Calendar wizard session...');
  const session = await requestWizardWithAutoCancel(client, 'calendar', 15 * 60 * 1000);

  // Install SIGINT/SIGTERM handlers so Ctrl+C during the wizard cancels
  // the session on the supervisor and does not orphan the setup-server
  // child inside the container.
  const cleanup = installWizardCleanupHandlers(client, session);

  // The wizard listens on session.port (PORT + 1) inside the container,
  // exposed on the host via the compose port mapping.
  const wizardUrl = parseEnvFile().LIMBO_PUBLIC_URL
    ? `${parseEnvFile().LIMBO_PUBLIC_URL}/?token=${session.token}`
    : `http://127.0.0.1:${session.port}/?token=${session.token}`;

  printWizardUrl(wizardUrl);

  // Poll the supervisor until the wizard session reaches a terminal state.
  try {
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      let status;
      try {
        status = await client.getWizard(session.id);
      } catch (err) {
        // 404 after completion = session was reaped; treat as done.
        if (err.status === 404) {
          ok(lang === 'es' ? 'Google Calendar conectado.' : 'Google Calendar connected.');
          return;
        }
        throw err;
      }
      if (status.status === 'done') {
        ok(lang === 'es' ? 'Google Calendar conectado.' : 'Google Calendar connected.');
        return;
      }
      if (status.status === 'error') {
        die(`Wizard failed: ${status.error || 'unknown error'}`);
      }
      if (status.status === 'timeout') {
        die(lang === 'es' ? 'El wizard expiró.' : 'Wizard timed out.');
      }
      // still pending/ready/active → keep polling
    }
  } finally {
    // Remove signal handlers so a normal completion does not cancel the
    // session on the way out (it is already terminal by this point).
    cleanup.uninstall();
  }
}

// ─── Limbo Cloud Commands ────────────────────────────────────────────────────

async function cmdCloudActivate() {
  const existingEnv = parseEnvFile();

  if (!existingEnv.MODEL_PROVIDER) {
    die('Instance is not configured yet. Run `limbo start` first.');
  }

  if (existingEnv.LIMBO_PUBLIC_URL) {
    log(`Already activated at ${existingEnv.LIMBO_PUBLIC_URL}`);
    return;
  }

  log('Detecting public IP...');
  const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => null);
  if (!ip) {
    die('Could not detect public IP address. Check your network connection.');
  }

  log(`Provisioning cloud instance for ${ip}...`);
  let provisionRes;
  try {
    provisionRes = await fetch(`${PROVISION_API_URL}/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROVISION_SECRET}`,
      },
      body: JSON.stringify({ ip }),
    });
  } catch (err) {
    die(`Could not reach provisioning API: ${err.message}`);
  }

  if (!provisionRes.ok) {
    const body = await provisionRes.text().catch(() => '');
    die(`Provisioning failed (${provisionRes.status}): ${body}`);
  }

  const { id, url } = await provisionRes.json();

  // Append cloud keys to .env
  const currentContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const updated = currentContent.trimEnd() + `\nLIMBO_PUBLIC_URL=${url}\nLIMBO_INSTANCE_ID=${id}\n`;
  safeWriteEnvFile(updated);

  // Regenerate compose (now includes 0.0.0.0:80:80 mapping)
  ensureComposeFile(false);

  // Restart container to pick up new port mapping
  runDockerCompose(['up', '-d']);

  console.log(`\n${c.green}✓ Cloud activated!${c.reset}`);
  console.log(`  Public URL: ${c.cyan}${url}${c.reset}`);
}

async function cmdCloudDeactivate() {
  const existingEnv = parseEnvFile();
  const id = existingEnv.LIMBO_INSTANCE_ID;

  if (!id) {
    die('Not activated. Run `limbo cloud activate` first.');
  }

  log(`Deprovisioning instance ${id}...`);
  try {
    await fetch(`${PROVISION_API_URL}/provision/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${PROVISION_SECRET}` },
    });
  } catch (err) {
    warn(`Could not reach provisioning API: ${err.message}. Removing local config anyway.`);
  }

  // Remove LIMBO_PUBLIC_URL and LIMBO_INSTANCE_ID from .env
  if (fs.existsSync(ENV_FILE)) {
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
    const filtered = lines.filter((l) => !l.startsWith('LIMBO_PUBLIC_URL=') && !l.startsWith('LIMBO_INSTANCE_ID='));
    safeWriteEnvFile(filtered.join('\n'));
  }

  // Regenerate compose (port 80 mapping will be absent now)
  ensureComposeFile(false);

  // Restart container
  runDockerCompose(['up', '-d']);

  ok('Cloud deactivated. Back to localhost mode.');
}

function cmdCloudStatus() {
  const existingEnv = parseEnvFile();
  if (existingEnv.LIMBO_PUBLIC_URL) {
    console.log(`Cloud: ${c.green}active${c.reset}`);
    console.log(`  URL: ${c.cyan}${existingEnv.LIMBO_PUBLIC_URL}${c.reset}`);
  } else {
    console.log(`Cloud: ${c.dim}not activated${c.reset}`);
    console.log(`  Run 'limbo cloud activate' to get a public URL`);
  }
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
  config             Configure optional features (voice, web-search)
  switch-brain       Change your AI provider (opens a quick wizard)
  connect-calendar   Connect Google Calendar (opens a quick wizard)
  cloud activate     Get a public URL for this instance (https://{id}.heylimbo.com)
  cloud deactivate   Remove the public URL and go back to localhost mode
  cloud status       Show current cloud activation status
  help               Show this help

${c.bold}Flags:${c.reset}
  --cli                Use interactive CLI prompts instead of the web setup wizard
  --reconfigure        Reconfigure settings (opens wizard, or CLI prompts with --cli)
  --hardened           Enable egress proxy (restricts outbound to AI provider APIs only)
  --provider <name>    Set provider for headless install (openai, anthropic, openrouter)
  --api-key <key>      API key for headless install
  --model <name>       Model name (optional, uses provider default)
  --language <code>    Language: en, es (default: en)

${c.bold}Config:${c.reset}
  limbo config voice --enable --api-key gsk_xxx     Enable voice transcription
  limbo config voice --disable                       Disable voice transcription
  limbo config web-search --enable --api-key BSAxxx  Enable web search
  limbo config web-search --disable                  Disable web search
  limbo config voice --status                        Show feature status

${c.bold}Data directory:${c.reset} ${LIMBO_DIR}
`);
}

// ─── Update Notifier ─────────────────────────────────────────────────────────

const UPDATE_CHECK_FILE = path.join(LIMBO_DIR, '.update-check');
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Spawn a detached background process to check the npm registry.
// Writes {latest, checkedAt} to UPDATE_CHECK_FILE and exits.
function checkForUpdateInBackground() {
  try {
    let shouldCheck = true;
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      const cached = JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf8'));
      if (Date.now() - cached.checkedAt < UPDATE_CHECK_INTERVAL) shouldCheck = false;
    }
    if (!shouldCheck) return;

    // Spawn detached child that hits the registry and writes cache
    const child = spawn(process.execPath, ['-e', `
      const https = require('https');
      const fs = require('fs');
      const req = https.get('https://registry.npmjs.org/limbo-ai/latest', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const { version } = JSON.parse(data);
            fs.mkdirSync('${LIMBO_DIR.replace(/\\/g, '\\\\')}', { recursive: true });
            fs.writeFileSync('${UPDATE_CHECK_FILE.replace(/\\/g, '\\\\')}', JSON.stringify({ latest: version, checkedAt: Date.now() }));
          } catch {}
        });
      });
      req.on('error', () => {});
      req.end();
    `], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {}
}

// Read cache and print banner if a newer version is available.
function notifyUpdate() {
  try {
    if (!fs.existsSync(UPDATE_CHECK_FILE)) return;
    const { latest } = JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf8'));
    const pkg = require('./package.json');
    if (!latest || latest === pkg.version) return;

    // Simple semver compare: split on dots, compare numerically
    const cur = pkg.version.split('.').map(Number);
    const lat = latest.split('.').map(Number);
    const isNewer = lat[0] > cur[0] || (lat[0] === cur[0] && lat[1] > cur[1]) ||
      (lat[0] === cur[0] && lat[1] === cur[1] && lat[2] > cur[2]);
    if (!isNewer) return;

    // Strip ANSI escapes for visible-length padding
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - strip(s).length));

    const line = `  Update available: ${c.dim}${pkg.version}${c.reset} → ${c.green}${latest}${c.reset}  `;
    const instruction = `  Run ${c.cyan}npx limbo-ai@latest update${c.reset} to update  `;
    const inner = Math.max(strip(line).length, strip(instruction).length);
    const border = '─'.repeat(inner);
    console.error(`\n  ${c.dim}╭${border}╮${c.reset}`);
    console.error(`  ${c.dim}│${c.reset}${pad(line, inner)}${c.dim}│${c.reset}`);
    console.error(`  ${c.dim}│${c.reset}${pad(instruction, inner)}${c.dim}│${c.reset}`);
    console.error(`  ${c.dim}╰${border}╯${c.reset}\n`);
  } catch {}
}

// ─── Exports (for testing) ────────────────────────────────────────────────────

module.exports = {
  MODEL_CATALOG,
  normalizeConfig,
  parseEnvFile,
  deriveProviderFamily,
  getModelCatalog,
  parseCallbackInput,
  decodeJwtPayload,
  parseClaudeSetupToken,
  buildCodexAuthProfile,
  buildAnthropicAuthProfile,
  generatePKCE,
  buildOAuthUrl,
  // Exported for tests — the real commands still run through the CLI entrypoint.
  writeEnv,
  safeWriteEnvFile,
  ensureComposeFile,
  migrateLegacySecretsToEnv,
  writeMinimalEnv,
};

// ─── Main ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, cmd = 'start'] = process.argv;

  (async () => {
    if (cmd !== 'update') checkForUpdateInBackground();

    switch (cmd) {
      case 'start':
      case 'install': await cmdStart(); break;
      case 'stop':    cmdStop(); break;
      case 'logs':    cmdLogs(); break;
      case 'update':  cmdUpdate(); break;
      case 'status':  cmdStatus(); break;
      case 'config':  cmdConfig(); break;
      case 'switch-brain': await cmdSwitchBrain(); break;
      case 'connect-calendar': await cmdConnectCalendar(); break;
      case 'cloud': {
        const cloudSub = process.argv[3];
        if (cloudSub === 'activate') await cmdCloudActivate();
        else if (cloudSub === 'deactivate') await cmdCloudDeactivate();
        else if (cloudSub === 'status') cmdCloudStatus();
        else die('Usage: limbo cloud [activate|deactivate|status]');
        break;
      }
      case 'version':
      case '--version':
      case '-v':      console.log(require('./package.json').version); break;
      case 'help':
      case '--help':
      case '-h':      cmdHelp(); break;
      default:
        warn(t('en', 'unknownCommand', cmd));
        cmdHelp();
        process.exit(1);
    }

    notifyUpdate();
  })().catch((err) => {
    die(err.message || String(err));
  });
}
