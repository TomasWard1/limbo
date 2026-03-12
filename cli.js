#!/usr/bin/env node
// cli.js — Limbo CLI
// Orchestrates the Docker-based Limbo runtime.
// Zero npm dependencies — pure Node.js stdlib.
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────

const LIMBO_DIR = path.join(os.homedir(), '.limbo');
const ENV_FILE = path.join(LIMBO_DIR, '.env');
const COMPOSE_FILE = path.join(LIMBO_DIR, 'docker-compose.yml');
const GHCR_IMAGE = 'ghcr.io/tomasward1/limbo';
const DEFAULT_TAG = '1.0.0';
const PORT = 18789;

// docker-compose.yml written to ~/.limbo on install
const COMPOSE_CONTENT = `services:
  limbo:
    image: ${GHCR_IMAGE}:\${LIMBO_IMAGE_TAG:-${DEFAULT_TAG}}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    volumes:
      - limbo-data:/data
    env_file:
      - .env
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
`;

// ─── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  cyan:  '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red:   '\x1b[31m',
};

const log   = (msg) => console.log(`${c.cyan}[limbo]${c.reset} ${msg}`);
const ok    = (msg) => console.log(`${c.green}[limbo]${c.reset} ${msg}`);
const warn  = (msg) => console.log(`${c.yellow}[limbo]${c.reset} ${msg}`);
const die   = (msg) => { console.error(`${c.red}[limbo] ERROR:${c.reset} ${msg}`); process.exit(1); };
const header = (msg) => console.log(`\n${c.bold}${msg}${c.reset}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function collectConfig() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Limbo supports Anthropic (Claude) and OpenAI as model providers.');
  console.log('Telegram integration is optional — press Enter to skip.\n');

  const provider = (await prompt(rl, '  Model provider (anthropic/openai) [anthropic]: ')).trim() || 'anthropic';
  const isOpenAI = provider === 'openai';
  const defaultModel = isOpenAI ? 'codex-mini-latest' : 'claude-sonnet-4-6';
  const keyLabel = isOpenAI ? 'OpenAI API key (sk-...)' : 'Anthropic API key (sk-ant-...)';

  let llmKey = '';
  while (!llmKey) {
    llmKey = (await prompt(rl, `  ${keyLabel}: `)).trim();
    if (!llmKey) warn('This field is required.');
  }

  const modelName = (await prompt(rl, `  Model name [${defaultModel}]: `)).trim() || defaultModel;
  const tgRaw = (await prompt(rl, '  Enable Telegram bot? (true/false) [false]: ')).trim() || 'false';
  const telegramEnabled = tgRaw === 'true' ? 'true' : 'false';
  let telegramToken = '';
  if (telegramEnabled === 'true') {
    while (!telegramToken) {
      telegramToken = (await prompt(rl, '  Telegram bot token: ')).trim();
      if (!telegramToken) warn('This field is required when Telegram is enabled.');
    }
  }

  const tag = (await prompt(rl, `  Image tag [${DEFAULT_TAG}]: `)).trim() || DEFAULT_TAG;

  rl.close();
  return { provider: isOpenAI ? 'openai' : 'anthropic', llmKey, modelName, telegramEnabled, telegramToken, tag };
}

function writeEnv({ provider, llmKey, modelName, telegramEnabled, telegramToken, tag }) {
  const content = [
    `LLM_API_KEY=${llmKey}`,
    `MODEL_PROVIDER=${provider}`,
    `MODEL_NAME=${modelName}`,
    `TELEGRAM_ENABLED=${telegramEnabled}`,
    `TELEGRAM_BOT_TOKEN=${telegramToken}`,
    `LIMBO_IMAGE_TAG=${tag}`,
  ].join('\n') + '\n';
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
}

function waitForHealthy(maxAttempts = 12) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const raw = runQuiet('docker compose ps --format json');
      if (raw.includes('"healthy"')) return true;
    } catch {}
    log(`Waiting for container to be healthy... (${i}/${maxAttempts})`);
    // simple sync sleep
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  return false;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStart() {
  header('=== Limbo ===');

  if (!hasDocker()) {
    die('Docker is not installed or `docker compose` is unavailable.\nInstall Docker Desktop: https://docs.docker.com/get-docker/');
  }

  fs.mkdirSync(LIMBO_DIR, { recursive: true });
  fs.writeFileSync(COMPOSE_FILE, COMPOSE_CONTENT);

  const alreadyHasEnv = fs.existsSync(ENV_FILE);
  let cfg;

  if (alreadyHasEnv) {
    log(`Found existing config at ${ENV_FILE}`);
    const reconfig = process.argv.includes('--reconfigure');
    if (!reconfig) {
      log('Starting with existing config. Use --reconfigure to change settings.');
      cfg = null; // skip writing
    } else {
      header('Reconfiguration');
      cfg = await collectConfig();
    }
  } else {
    header('Configuration');
    cfg = await collectConfig();
  }

  if (cfg) {
    writeEnv(cfg);
    ok('.env written.');
  }

  header('Pulling image...');
  try {
    run('docker compose pull -q');
    ok('Image pulled.');
  } catch {
    warn('Could not pull from GHCR. Is the image public? Trying local build fallback...');
    // Fallback: build from current directory if we're inside the repo
    const repoDockerfile = path.join(__dirname, 'Dockerfile');
    if (fs.existsSync(repoDockerfile)) {
      log('Building from local Dockerfile...');
      const tag = cfg?.tag || DEFAULT_TAG;
      execSync(`docker build -t ${GHCR_IMAGE}:${tag} .`, { stdio: 'inherit', cwd: __dirname });
      ok(`Built: ${GHCR_IMAGE}:${tag}`);
    } else {
      die('Could not pull image and no local Dockerfile found. Check your network or GHCR access.');
    }
  }

  header('Starting Limbo...');
  run('docker compose up -d --remove-orphans');

  header('Verifying health...');
  const healthy = waitForHealthy();
  if (!healthy) {
    warn('Container did not report healthy within timeout.');
    warn(`Check logs with: limbo logs`);
  } else {
    ok('Container is healthy.');
  }

  console.log(`
${c.green}${c.bold}╔════════════════════════════════════════════╗${c.reset}
${c.green}${c.bold}║       Limbo is running!                    ║${c.reset}
${c.green}${c.bold}╚════════════════════════════════════════════╝${c.reset}

  ${c.bold}Gateway:${c.reset}  ws://127.0.0.1:${PORT}
  ${c.bold}Data:${c.reset}     ${LIMBO_DIR}
  ${c.bold}Logs:${c.reset}     limbo logs
  ${c.bold}Stop:${c.reset}     limbo stop
  ${c.bold}Update:${c.reset}   limbo update
`);
}

function cmdStop() {
  if (!fs.existsSync(COMPOSE_FILE)) die('Limbo is not installed. Run: npx limbo-ai start');
  log('Stopping Limbo...');
  run('docker compose down');
  ok('Stopped.');
}

function cmdLogs() {
  if (!fs.existsSync(COMPOSE_FILE)) die('Limbo is not installed. Run: npx limbo-ai start');
  run('docker compose logs -f');
}

function cmdUpdate() {
  if (!fs.existsSync(COMPOSE_FILE)) die('Limbo is not installed. Run: npx limbo-ai start');
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
${c.bold}limbo${c.reset} — personal AI memory agent

${c.bold}Usage:${c.reset}
  npx limbo-ai [command]

${c.bold}Commands:${c.reset}
  start         Install and start Limbo (default if no command given)
  stop          Stop the running container
  logs          Tail container logs
  update        Pull latest image and restart
  status        Show container status
  help          Show this help

${c.bold}Flags:${c.reset}
  --reconfigure  Reconfigure API keys and settings (use with start)

${c.bold}Data directory:${c.reset} ${LIMBO_DIR}
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, cmd = 'start'] = process.argv;

(async () => {
  switch (cmd) {
    case 'start':
    case 'install': await cmdStart(); break;
    case 'stop':    cmdStop();  break;
    case 'logs':    cmdLogs();  break;
    case 'update':  cmdUpdate(); break;
    case 'status':  cmdStatus(); break;
    case 'help':
    case '--help':
    case '-h':      cmdHelp(); break;
    default:
      warn(`Unknown command: ${cmd}`);
      cmdHelp();
      process.exit(1);
  }
})().catch((err) => {
  die(err.message || String(err));
});
