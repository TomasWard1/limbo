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
const DEFAULT_TAG = 'latest';
const DEFAULT_PORT = 18789;
const COEXIST_PORT = 18900;
let PORT = DEFAULT_PORT;

// ─── OpenClaw Detection ─────────────────────────────────────────────────────

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

function detectExistingOpenClaw() {
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
  const searchPaths = [
    '/opt/openclaw/.env',
    '/opt/openclaw/secrets/llm_api_key',
    path.join(os.homedir(), '.openclaw', '.env'),
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

// docker-compose.yml written to ~/.limbo on install
function composeContent() {
  return `services:
  limbo:
    image: ${GHCR_IMAGE}:${DEFAULT_TAG}
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - FOWNER
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev
    ports:
      - "${isServerEnvironment() ? '0.0.0.0' : '127.0.0.1'}:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
      - ${VAULT_DIR}:/data/vault
      - limbo-openclaw-state:/home/limbo/.openclaw
    secrets:
      - llm_api_key
      - telegram_bot_token
      - gateway_token
    env_file:
      - ${LIMBO_DIR}/.env
    environment:
      OPENCLAW_CONFIG_PATH: /home/limbo/.openclaw/openclaw.json
      OPENCLAW_STATE_DIR: /home/limbo/.openclaw
      LIMBO_PORT: "${PORT}"
      NODE_OPTIONS: "\${LIMBO_NODE_OPTIONS:---max-old-space-size=1024}"
    healthcheck:
      test:
        - CMD-SHELL
        - >-
          NODE_OPTIONS= node -e "const s=require('net').connect(${PORT},'127.0.0.1');const
          done=(c)=>{try{s.destroy()}catch{};process.exit(c)};s.on('connect',()=>done(0));s.on('error',()=>done(1));setTimeout(()=>done(1),2000);"
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

secrets:
  llm_api_key:
    file: ${SECRETS_DIR}/llm_api_key
  telegram_bot_token:
    file: ${SECRETS_DIR}/telegram_bot_token
  gateway_token:
    file: ${SECRETS_DIR}/gateway_token

volumes:
  limbo-data:
  limbo-openclaw-state:
`;
}

// Hardened variant: adds Squid egress proxy sidecar with domain allowlist
function composeContentHardened() {
  return `services:
  limbo:
    image: ${GHCR_IMAGE}:${DEFAULT_TAG}
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - FOWNER
    pids_limit: 200
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev
      - /home/limbo/.npm:size=50M,noexec,nosuid,nodev
    ports:
      - "${isServerEnvironment() ? '0.0.0.0' : '127.0.0.1'}:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
      - ${VAULT_DIR}:/data/vault
      - limbo-openclaw-state:/home/limbo/.openclaw
    secrets:
      - llm_api_key
      - telegram_bot_token
      - gateway_token
    env_file:
      - ${LIMBO_DIR}/.env
    environment:
      OPENCLAW_CONFIG_PATH: /home/limbo/.openclaw/openclaw.json
      OPENCLAW_STATE_DIR: /home/limbo/.openclaw
      LIMBO_PORT: "${PORT}"
      NODE_OPTIONS: "\${LIMBO_NODE_OPTIONS:---max-old-space-size=1024}"
      HTTP_PROXY: http://squid:3128
      HTTPS_PROXY: http://squid:3128
      NO_PROXY: "127.0.0.1,localhost"
    networks:
      - internal
    healthcheck:
      test:
        - CMD-SHELL
        - >-
          NODE_OPTIONS= node -e "const s=require('net').connect(${PORT},'127.0.0.1');const
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
      - ${LIMBO_DIR}/squid/squid.conf:/etc/squid/squid.conf:ro
      - ${LIMBO_DIR}/squid/allowed-domains.txt:/etc/squid/allowed-domains.txt:ro

networks:
  internal:
    internal: true
  external:

secrets:
  llm_api_key:
    file: ${SECRETS_DIR}/llm_api_key
  telegram_bot_token:
    file: ${SECRETS_DIR}/telegram_bot_token
  gateway_token:
    file: ${SECRETS_DIR}/gateway_token

volumes:
  limbo-data:
  limbo-openclaw-state:
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
    LIMBO_PORT: String(PORT),
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
  'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY',
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

  // Check for existing API keys from another OpenClaw installation
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
  fs.writeFileSync(COMPOSE_FILE, hardened ? composeContentHardened() : composeContent());
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
  // When running from the repo (npx .), prefer local build over registry pull.
  const repoDockerfile = path.join(__dirname, 'Dockerfile');
  if (fs.existsSync(repoDockerfile)) {
    header(t(lang, 'buildingFallback'));
    execSync(`docker build -t ${GHCR_IMAGE}:${DEFAULT_TAG} .`, { stdio: 'inherit', cwd: __dirname });
    ok(t(lang, 'buildOk', DEFAULT_TAG));
    return;
  }

  header(t(lang, 'pullingImage'));
  try {
    run('docker compose pull -q');
    ok(t(lang, 'imagePulled'));
  } catch {
    die('Could not pull image and no local Dockerfile found. Check your network or GHCR access.');
  }
}

function runOpenClaw(args, opts = {}) {
  // 1024MB heap: openclaw config needs ~800MB; 512/768 OOM in 2GB VPS tests.
  return runDockerCompose(['run', '--rm', '-e', 'NODE_OPTIONS=--max-old-space-size=1024', '--entrypoint', 'openclaw', 'limbo', ...args], opts);
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

// ─── Server detection & Cloudflare tunnel for remote wizard access ──────────

function isServerEnvironment() {
  return !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT ||
    (os.platform() === 'linux' && !process.env.DISPLAY));
}

function hasCloudflared() {
  try { execSync('which cloudflared', { stdio: 'pipe' }); return true; } catch { return false; }
}

function installCloudflared() {
  log('Installing cloudflared...');
  const platform = os.platform();
  try {
    if (platform === 'linux') {
      execSync('curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared', { stdio: 'pipe' });
    } else if (platform === 'darwin') {
      execSync('brew install cloudflared', { stdio: 'pipe' });
    }
    return true;
  } catch {
    warn('Could not install cloudflared automatically.');
    return false;
  }
}

function createSetupTunnel(port, tunnelDomain) {
  if (!hasCloudflared() && !installCloudflared()) return null;
  if (!hasCloudflared()) return null;

  const tunnelId = crypto.randomBytes(4).toString('hex');

  // Admin mode: branded subdomain (requires cloudflared login for the zone)
  if (tunnelDomain) {
    const tunnelName = `limbo-setup-${tunnelId}`;
    const subdomain = `setup-${tunnelId}.${tunnelDomain}`;
    try {
      execSync(`cloudflared tunnel create ${tunnelName}`, { stdio: 'pipe', encoding: 'utf8' });
      execSync(`cloudflared tunnel route dns ${tunnelName} ${subdomain}`, { stdio: 'pipe', encoding: 'utf8' });

      const cfHome = path.join(os.homedir(), '.cloudflared');
      const tunnelInfoRaw = execSync(`cloudflared tunnel info ${tunnelName} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
      const tunnelUuid = tunnelInfoRaw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
      if (!tunnelUuid) throw new Error('Could not find tunnel UUID');

      const credFile = path.join(cfHome, `${tunnelUuid}.json`);
      const configPath = path.join(LIMBO_DIR, 'cloudflared-setup.yml');
      fs.writeFileSync(configPath, [
        `tunnel: ${tunnelUuid}`,
        `credentials-file: ${credFile}`,
        'ingress:',
        `  - hostname: ${subdomain}`,
        `    service: http://localhost:${port}`,
        '  - service: http_status:404',
      ].join('\n'));

      const tunnelProc = spawn('cloudflared', ['tunnel', '--config', configPath, 'run'], {
        detached: true, stdio: 'ignore',
      });
      tunnelProc.unref();
      sleep(5000);

      return { type: 'branded', url: `https://${subdomain}`, tunnelName, tunnelUuid, configPath, pid: tunnelProc.pid };
    } catch (err) {
      warn(`Could not create branded tunnel: ${err.message}`);
      warn('Make sure you ran `cloudflared login` for this domain first.');
      // Fall through to quick tunnel
    }
  }

  // Default: quick tunnel (zero config, works for everyone)
  try {
    const logFile = path.join(LIMBO_DIR, 'cloudflared-setup.log');
    const tunnelProc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--config', '/dev/null', '--url', `http://localhost:${port}`], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')],
    });
    tunnelProc.unref();

    for (let i = 0; i < 15; i++) {
      sleep(1000);
      try {
        const logs = fs.readFileSync(logFile, 'utf8');
        const match = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) return { type: 'quick', url: match[0], pid: tunnelProc.pid, logFile };
      } catch {}
    }
    warn('Could not start cloudflare tunnel.');
    return null;
  } catch {
    return null;
  }
}

function teardownSetupTunnel(tunnel) {
  if (!tunnel) return;
  try { process.kill(tunnel.pid); } catch {}

  if (tunnel.type === 'branded') {
    try { execSync(`cloudflared tunnel delete -f ${tunnel.tunnelName}`, { stdio: 'pipe' }); } catch {}
    try { fs.unlinkSync(tunnel.configPath); } catch {}
  }
  if (tunnel.logFile) try { fs.unlinkSync(tunnel.logFile); } catch {}
}

function installGlobalAlias() {
  // Create a `limbo` shell wrapper so users don't have to type `npx limbo-ai` every time.
  // Tries /usr/local/bin first (macOS, Linux with sudo), falls back to ~/.local/bin (no sudo).
  const wrapper = '#!/bin/sh\nexec npx limbo-ai "$@"\n';
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'limbo'),
    '/usr/local/bin/limbo',
  ];

  for (const target of candidates) {
    try {
      // Skip if already installed and current
      if (fs.existsSync(target)) {
        const existing = fs.readFileSync(target, 'utf8');
        if (existing.includes('limbo-ai')) return;
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

function isOomError(stderr) {
  return typeof stderr === 'string' && (
    stderr.includes('heap out of memory') ||
    stderr.includes('Allocation failed') ||
    stderr.includes('FATAL ERROR: Reached heap limit')
  );
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

function handleConfigOom(lang) {
  console.log('');
  die([
    t(lang, 'configOom'),
    countRunningLimboContainers() > 0
      ? t(lang, 'configOomContainers', countRunningLimboContainers())
      : t(lang, 'configOomHint'),
    t(lang, 'configOomOverride'),
  ].join('\n'));
}

function applyOpenClawConfig(cfg) {
  header(t(cfg.language, 'configFlowStart'));
  log(t(cfg.language, 'configFlowSlow'));

  // Stop existing containers to free memory before running config commands
  stopExistingContainers(cfg.language);

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

  const total = setCommands.length + 1; // +1 for validate
  let step = 0;

  for (const command of setCommands) {
    step++;
    process.stdout.write(`\r${c.dim}  [${step}/${total}] ${command.slice(1, 4).join(' ')}${c.reset}`.padEnd(60));
    const result = runOpenClaw(command, { stdio: 'pipe' });
    if (result.status !== 0) {
      if (isOomError(result.stderr)) handleConfigOom(cfg.language);
      console.log('');
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      die(t(cfg.language, 'configFlowFailed'));
    }
  }

  if (cfg.telegramEnabled !== 'true') {
    runOpenClaw(['config', 'unset', 'channels.telegram'], { stdio: 'pipe' });
  }

  step++;
  process.stdout.write(`\r${c.dim}  [${step}/${total}] config validate${c.reset}`.padEnd(60));
  const validateResult = runOpenClaw(['config', 'validate'], { stdio: 'pipe' });
  if (validateResult.status !== 0) {
    if (isOomError(validateResult.stderr)) handleConfigOom(cfg.language);
    console.log('');
    process.stdout.write(validateResult.stdout || '');
    process.stderr.write(validateResult.stderr || '');
    die(t(cfg.language, 'configFlowFailed'));
  }

  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  ok(t(cfg.language, 'configFlowDone'));
}

// ─── Native OAuth (PKCE) for OpenAI Codex ───────────────────────────────────
// Implements the full OAuth flow locally so we never need OpenClaw's interactive TUI.

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
  const destDir = '/home/limbo/.openclaw/agents/main/agent';
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

function buildCodexAuthProfile(profile) {
  const profileId = profile.email ? `openai-codex:${profile.email}` : 'openai-codex:default';
  return {
    version: 1,
    profiles: {
      [profileId]: {
        type: 'oauth',
        provider: 'openai-codex',
        access: profile.access,
        refresh: profile.refresh,
        expires: profile.expires,
        accountId: profile.accountId,
      },
    },
    order: {},
    lastGood: {},
    usageStats: {},
  };
}

function buildAnthropicAuthProfile(token) {
  return {
    version: 1,
    profiles: {
      'anthropic:token': {
        type: 'token',
        provider: 'anthropic',
        token,
      },
    },
    order: { anthropic: ['anthropic:token'] },
    lastGood: {},
    usageStats: {},
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

function extractWizardUrl(maxAttempts = 15) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const logs = runDockerCompose(['logs', '--no-log-prefix'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      const output = logs.stdout || '';
      const match = output.match(/SETUP_URL=(https?:\/\/\S+)/);
      if (match) return match[1];
    } catch {}
    log(`Waiting for setup wizard URL... (${i}/${maxAttempts})`);
    sleep(2000);
  }
  return null;
}

function printWizardUrl(url, tunnel) {
  // Extract token from the original URL
  const tokenMatch = url.match(/[?&]token=([^&\s]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';

  let displayUrl;
  if (tunnel) {
    displayUrl = `${tunnel.url}/?token=${token}`;
  } else {
    displayUrl = url.replace('0.0.0.0', '127.0.0.1');
  }

  console.log(`
${c.green}${c.bold}╔════════════════════════════════════════════════════════╗${c.reset}
${c.green}${c.bold}║            Setup wizard is ready!                      ║${c.reset}
${c.green}${c.bold}╚════════════════════════════════════════════════════════╝${c.reset}

  Open this URL to complete setup:

  ${c.cyan}${c.bold}${displayUrl}${c.reset}
${tunnel ? `
  ${c.green}🔒 Secured via Cloudflare (${tunnel.type === 'branded' ? tunnel.url.replace('https://', '') : 'HTTPS tunnel'})${c.reset}` : ''}
  The wizard will guide you through provider, API key, and model selection.
  Once complete, Limbo will restart and be ready to use.

  ${c.dim}Logs: limbo logs | Stop: limbo stop${c.reset}
`);
  // Auto-open on macOS
  if (os.platform() === 'darwin' && !tunnel) {
    try { execSync(`open "${displayUrl}"`, { stdio: 'pipe' }); } catch {}
  }
}

function writeMinimalEnv() {
  ensureComposeFile(false);
  const gatewayToken = ensureGatewayToken({});
  const content = `CLI_LANGUAGE=en\nLIMBO_PORT=${PORT}\n`;
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
  // Ensure gateway token secret exists for compose
  writeSecretFile('gateway_token', gatewayToken);
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

  // ── Detect existing OpenClaw / port selection ─────────────────────────────
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
    const existing = detectExistingOpenClaw();
    if (existing) {
      console.log(`
  ${c.yellow}${c.bold}Existing OpenClaw detected${c.reset}
  ${c.dim}Port ${existing.port} is in use (${existing.processInfo})${c.reset}

  Limbo will run its own OpenClaw instance on port ${c.bold}${COEXIST_PORT}${c.reset}.
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
  const flagTunnelDomain = parseFlag('--tunnel-domain');

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

  // ── Route: Wizard reconfigure (--reconfigure, no --cli) ───────────────────
  if (reconfig && hasProviderConfig) {
    log('Resetting configuration for setup wizard...');
    // Remove provider config from .env so container enters setup mode
    const minimalContent = `CLI_LANGUAGE=${existingEnv.CLI_LANGUAGE || 'en'}\nLIMBO_PORT=${PORT}\n`;
    fs.writeFileSync(ENV_FILE, minimalContent, { mode: 0o600 });
    // Keep gateway token secret intact
    ensureGatewayToken(existingEnv);
  }

  // ── Route: Wizard (default for fresh install or wizard reconfigure) ───────
  log('Starting Limbo with setup wizard...');
  if (!alreadyHasEnv || (reconfig && hasProviderConfig)) {
    writeMinimalEnv();
  }

  pullOrBuildImage('en');
  ensureVolumePermissions();

  header('Starting Limbo...');
  log('Starting container...');
  const upResult = runDockerCompose(['up', '-d', '--remove-orphans'], { stdio: 'pipe' });
  if (upResult.status !== 0) {
    process.stderr.write(upResult.stderr || '');
    die('Container failed to start. Run `limbo logs` to investigate.');
  }

  header('Waiting for setup wizard...');
  const healthy = waitForHealthy('en');
  if (!healthy) {
    warn('Container did not become healthy in time.');
    warn('Check logs with: limbo logs');
  } else {
    ok('Container is healthy.');
  }

  const wizardUrl = extractWizardUrl();
  if (wizardUrl) {
    // On servers, create a secure tunnel for remote access
    let tunnel = null;
    if (isServerEnvironment()) {
      log('Server environment detected — creating secure tunnel...');
      tunnel = createSetupTunnel(PORT, flagTunnelDomain);
    }
    printWizardUrl(wizardUrl, tunnel);
  } else {
    // Fallback: container may have started without setup mode (e.g. config already inside volume)
    console.log(`
  ${c.yellow}Could not detect setup wizard URL.${c.reset}
  The container may already be configured.

  Try: ${c.cyan}http://127.0.0.1:${PORT}${c.reset}
  Logs: ${c.dim}limbo logs${c.reset}
`);
  }
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

  installGlobalAlias();

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

  // Patch image tag to :latest in existing compose files (handles upgrades from pinned tags)
  let compose = fs.readFileSync(COMPOSE_FILE, 'utf8');
  const patched = compose.replace(
    /image:\s*ghcr\.io\/tomasward1\/limbo:\S+/g,
    `image: ${GHCR_IMAGE}:${DEFAULT_TAG}`
  );
  if (patched !== compose) {
    compose = patched;
    fs.writeFileSync(COMPOSE_FILE, compose);
    log('Patched compose image tag to :latest');
  }

  // Inject NODE_OPTIONS into existing compose files to prevent OOM on low-memory VPS.
  // Uses LIMBO_NODE_OPTIONS env var with 1024MB default so users on bigger servers can override.
  if (!compose.includes('NODE_OPTIONS')) {
    const injected = compose.replace(
      /^(\s+)(LIMBO_PORT:\s*.+)$/m,
      '$1$2\n$1NODE_OPTIONS: "${LIMBO_NODE_OPTIONS:---max-old-space-size=1024}"'
    );
    if (injected !== compose) {
      compose = injected;
      fs.writeFileSync(COMPOSE_FILE, compose);
      log('Added NODE_OPTIONS to compose environment');
    }
  }

  log('Pulling latest image...');
  run(`docker compose -f "${COMPOSE_FILE}" pull -q`);
  log('Restarting...');
  run(`docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans`);
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
  --cli                Use interactive CLI prompts instead of the web setup wizard
  --reconfigure        Reconfigure settings (opens wizard, or CLI prompts with --cli)
  --hardened           Enable egress proxy (restricts outbound to AI provider APIs only)
  --provider <name>    Set provider for headless install (openai, anthropic, openrouter)
  --api-key <key>      API key for headless install
  --model <name>       Model name (optional, uses provider default)
  --language <code>    Language: en, es (default: en)
  --tunnel-domain <d>  Admin: use branded subdomain for setup tunnel (e.g. limbo.tomasward.com)

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
