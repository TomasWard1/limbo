#!/usr/bin/env node
// setup-server/server.js — Limbo Setup Wizard HTTP Server
// Pure Node.js, zero external dependencies.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.LIMBO_PORT, 10) || 18789;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.LIMBO_DATA_DIR || '/data';
const OPENCLAW_STATE = process.env.OPENCLAW_STATE_DIR || '/home/limbo/.openclaw';
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const SECRETS_DIR = path.join(OPENCLAW_STATE, 'secrets');
const ENV_FILE = path.join(CONFIG_DIR, '.env');
const SETUP_TOKEN_FILE = path.join(CONFIG_DIR, 'setup_token');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ─── Model Catalog ───────────────────────────────────────────────────────────

const MODEL_CATALOG = {
  anthropic: {
    defaultModel: 'claude-opus-4-6',
    models: [
      { id: 'claude-opus-4-6',          name: 'Claude Opus 4.6',  default: true },
      { id: 'claude-sonnet-4-6',        name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    defaultModel: 'gpt-5.4',
    models: [
      { id: 'gpt-5.4',      name: 'GPT-5.4',      default: true },
      { id: 'gpt-4.1',      name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'o3',           name: 'o3' },
      { id: 'o4-mini',      name: 'o4-mini' },
    ],
  },
  openrouter: {
    defaultModel: 'anthropic/claude-opus-4-6',
    models: [
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6 (Anthropic)', default: true },
      { id: 'openai/gpt-5.4',            name: 'GPT-5.4 (OpenAI)' },
      { id: 'google/gemini-2.5-pro',     name: 'Gemini 2.5 Pro (Google)' },
      { id: 'deepseek/deepseek-r1',      name: 'DeepSeek R1' },
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick (Meta)' },
    ],
  },
};

// ─── Key Validation Prefixes ─────────────────────────────────────────────────

const KEY_PREFIXES = {
  openai:     'sk-',
  anthropic:  'sk-ant-',
  openrouter: 'sk-or-',
};

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 64) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

function writeSecretFile(name, value) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const filePath = path.join(SECRETS_DIR, name);
  fs.writeFileSync(filePath, value || '', { mode: 0o600 });
}

function readSecretFile(name) {
  try {
    return fs.readFileSync(path.join(SECRETS_DIR, name), 'utf8').trim();
  } catch {
    return '';
  }
}

function ensureGatewayToken() {
  const existing = readSecretFile('gateway_token');
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString('base64url');
  writeSecretFile('gateway_token', token);
  return token;
}

// ─── Setup Token ──────────────────────────────────────────────────────────────

function ensureSetupToken() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
  try {
    const existing = fs.readFileSync(SETUP_TOKEN_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch { /* file doesn't exist */ }
  const token = crypto.randomBytes(16).toString('base64url');
  fs.writeFileSync(SETUP_TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

let SETUP_TOKEN = null;
if (require.main === module) {
  SETUP_TOKEN = ensureSetupToken();
}

function checkToken(req) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  // Check query param
  if (parsed.searchParams.get('token') === SETUP_TOKEN) return true;
  // Check Authorization header
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${SETUP_TOKEN}`) return true;
  return false;
}

function sendForbidden(res) {
  // Auto-retry page: if the user lands here without a token (e.g. DNS resolved
  // but the browser dropped the ?token= query param, or Chrome served a stale
  // error frame), retry with the full URL from the address bar every 2s.
  // This prevents Chrome from getting stuck on chrome-error://chromewebdata/.
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Limbo — Connecting...</title>
    <style>body{font-family:system-ui;background:#0D0D0D;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .c{text-align:center}.t{color:#9C9B99;margin-top:12px;font-size:14px}.d{color:#555;font-size:12px;margin-top:8px}</style></head>
    <body><div class="c"><h1>limbo</h1><p class="t" id="msg">Connecting...</p><p class="d" id="detail"></p></div>
    <script>
    (function(){var n=0,max=15;function retry(){if(n>=max){document.getElementById('msg').textContent='Setup token required.';document.getElementById('detail').textContent='Check your server logs for the setup URL.';return}n++;document.getElementById('detail').textContent='Attempt '+n+'/'+max;window.location.reload()}setTimeout(retry,2000)})();
    </script></body></html>`;
  res.writeHead(403, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

// ─── OpenAI OAuth PKCE ────────────────────────────────────────────────────────

const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  fallbackRedirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access',
};

// In-memory PKCE session (single-user setup wizard)
let pkceSession = null;
// Track OAuth completion for polling
let oauthResult = null;

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildOAuthUrl(pkce, state, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_OAUTH.clientId,
    redirect_uri: redirectUri,
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

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
}

// ─── OpenAI Codex auth profiles ──────────────────────────────────────────────
// OpenAI OAuth tokens expire and need refresh. OpenClaw reads auth-profiles.json
// for the refresh token and handles renewal automatically. This is ONLY needed
// for OpenAI Codex — Anthropic tokens are static and stored as secrets instead.
// OpenClaw stores auth profiles per-agent: agents/{id}/agent/auth-profiles.json
// The default agent is "main".
const AUTH_PROFILES_DIR = path.join(OPENCLAW_STATE, 'agents', 'main', 'agent');
const AUTH_PROFILES_FILE = path.join(AUTH_PROFILES_DIR, 'auth-profiles.json');

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

function writeAuthProfiles(store) {
  fs.mkdirSync(AUTH_PROFILES_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(AUTH_PROFILES_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  log('Auth profile written to ' + AUTH_PROFILES_FILE);
}

// ─── Telegram API Helpers ────────────────────────────────────────────────────

const https = require('https');

function telegramApiGet(token, method, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const urlPath = `/bot${token}/${method}${qs ? '?' + qs : ''}`;
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.telegram.org',
      path: urlPath,
      timeout: 35000,
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Telegram API')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Telegram API timeout')); });
  });
}

function telegramApiPost(token, method, body) {
  const jsonBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonBody),
      },
      timeout: 10000,
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Telegram API')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Telegram API timeout')); });
    req.write(jsonBody);
    req.end();
  });
}

// ─── Telegram Pairing Handlers ──────────────────────────────────────────────

async function handleTelegramValidate(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data || !data.botToken) {
    return sendError(res, 400, 'Missing botToken');
  }

  try {
    const result = await telegramApiGet(data.botToken, 'getMe');
    if (result.ok) {
      sendJSON(res, 200, {
        valid: true,
        botUsername: result.result.username,
        botName: result.result.first_name,
      });
    } else {
      sendJSON(res, 200, { valid: false, error: result.description });
    }
  } catch (err) {
    sendError(res, 500, `Telegram API error: ${err.message}`);
  }
}

async function handleTelegramPair(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data || !data.botToken) {
    return sendError(res, 400, 'Missing botToken');
  }

  const token = data.botToken;

  try {
    // Check for existing messages first (non-blocking)
    let result = await telegramApiGet(token, 'getUpdates', { timeout: 0 });
    if (!result.ok) {
      return sendError(res, 502, `Telegram: ${result.description}`);
    }

    let updates = result.result || [];
    let targetUpdate = null;

    // Find the last message update
    for (const u of updates) {
      if (u.message && u.message.chat) targetUpdate = u;
    }

    if (!targetUpdate) {
      // Long poll for a new message (25s — Telegram holds the connection)
      const offset = updates.length > 0
        ? updates[updates.length - 1].update_id + 1
        : undefined;
      const pollParams = { timeout: 25, limit: 1 };
      if (offset !== undefined) pollParams.offset = offset;

      result = await telegramApiGet(token, 'getUpdates', pollParams);
      if (!result.ok) {
        return sendError(res, 502, `Telegram: ${result.description}`);
      }

      for (const u of (result.result || [])) {
        if (u.message && u.message.chat) targetUpdate = u;
      }
    }

    if (!targetUpdate) {
      return sendJSON(res, 200, { paired: false });
    }

    const chat = targetUpdate.message.chat;
    const chatId = String(chat.id);
    const firstName = chat.first_name || '';

    // Acknowledge all updates up to this one
    await telegramApiGet(token, 'getUpdates', {
      offset: targetUpdate.update_id + 1,
      timeout: 0,
      limit: 1,
    });

    // Send greeting
    const lang = data.language || 'en';
    const greeting = lang === 'es'
      ? `👋 ¡Hola${firstName ? ' ' + firstName : ''}! Limbo está configurado y listo. Podés hablarme por acá.`
      : `👋 Hey${firstName ? ' ' + firstName : ''}! Limbo is set up and ready. You can talk to me here.`;

    await telegramApiPost(token, 'sendMessage', { chat_id: chatId, text: greeting });

    // Persist chat_id
    writeSecretFile('telegram_chat_id', chatId);
    log(`Telegram paired: chat_id=${chatId} name=${firstName}`);

    sendJSON(res, 200, { paired: true, chatId, firstName });

  } catch (err) {
    log(`Telegram pair error: ${err.message}`);
    sendError(res, 500, `Telegram pairing error: ${err.message}`);
  }
}

// ─── Static File Serving ─────────────────────────────────────────────────────

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;

  // Prevent directory traversal
  const resolved = path.resolve(PUBLIC_DIR, '.' + filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(resolved, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendError(res, 404, 'Not found');
      } else {
        log(`Static file error: ${err.message}`);
        sendError(res, 500, 'Internal server error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

// ─── API Handlers ────────────────────────────────────────────────────────────

function handleGetModels(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const provider = parsed.searchParams.get('provider');
  if (provider && MODEL_CATALOG[provider]) {
    sendJSON(res, 200, MODEL_CATALOG[provider]);
  } else if (provider) {
    sendError(res, 400, `Unknown provider: ${provider}`);
  } else {
    sendJSON(res, 200, MODEL_CATALOG);
  }
}

async function handleValidateKey(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data || !data.provider || !data.apiKey) {
    sendError(res, 400, 'Missing provider or apiKey');
    return;
  }

  const prefix = KEY_PREFIXES[data.provider];
  if (!prefix) {
    sendError(res, 400, `Unknown provider: ${data.provider}`);
    return;
  }

  const valid = data.apiKey.startsWith(prefix) && data.apiKey.length > prefix.length;
  sendJSON(res, 200, { valid, provider: data.provider });
}

// ─── OAuth / Subscription Handlers ───────────────────────────────────────────

function handleOAuthStart(req, res) {
  const pkce = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = OPENAI_OAUTH.fallbackRedirectUri;
  pkceSession = { verifier: pkce.verifier, state, redirectUri, ts: Date.now() };
  oauthResult = null;
  const authUrl = buildOAuthUrl(pkce, state, redirectUri);
  sendJSON(res, 200, { authUrl });
}

// Shared token exchange logic
async function exchangeOAuthCode(code, verifier, redirectUri) {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OPENAI_OAUTH.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  return new Promise((resolve, reject) => {
    const reqUrl = new URL(OPENAI_OAUTH.tokenUrl);
    const postData = tokenBody.toString();
    const options = {
      hostname: reqUrl.hostname,
      path: reqUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const r = https.request(options, (response) => {
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        if (response.statusCode >= 400) {
          reject(new Error(`Token exchange failed (${response.statusCode}): ${responseBody}`));
        } else {
          resolve(JSON.parse(responseBody));
        }
      });
    });
    r.on('error', reject);
    r.write(postData);
    r.end();
  });
}

function processOAuthTokens(tokenRes) {
  const jwt = decodeJwtPayload(tokenRes.access_token);
  const authClaim = jwt['https://api.openai.com/auth'] || {};
  // Write auth profile for OpenClaw's OAuth refresh flow
  const store = buildCodexAuthProfile({
    access: tokenRes.access_token,
    refresh: tokenRes.refresh_token,
    expires: Date.now() + (tokenRes.expires_in * 1000),
    accountId: authClaim.chatgpt_account_id || '',
    email: jwt.email || '',
  });
  writeAuthProfiles(store);
  // Also write access token as secret for entrypoint to export
  writeSecretFile('llm_api_key', tokenRes.access_token);
  return { email: jwt.email || '' };
}

// GET /auth/callback — server-side OAuth callback (auto-capture)
async function handleOAuthCallback(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!pkceSession || pkceSession.state !== state) {
    serveCallbackPage(res, false, 'Invalid or expired session. Go back to the wizard and try again.');
    return;
  }

  try {
    const tokenRes = await exchangeOAuthCode(code, pkceSession.verifier, pkceSession.redirectUri);
    const { email } = processOAuthTokens(tokenRes);
    oauthResult = { success: true, email };
    pkceSession = null;
    log(`OAuth callback: authenticated as ${email}`);
    serveCallbackPage(res, true, email);
  } catch (err) {
    log(`OAuth callback error: ${err.message}`);
    serveCallbackPage(res, false, err.message);
  }
}

function serveCallbackPage(res, success, detail) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Limbo — ${success ? 'Connected!' : 'Error'}</title>
<style>body{font-family:'Outfit',system-ui,sans-serif;background:#0D0D0D;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
.c{max-width:420px;padding:24px}.ok{color:#3E8F5D;font-size:48px;margin-bottom:16px}.err{color:#C45C5C;font-size:48px;margin-bottom:16px}
h1{font-size:24px;font-weight:700;margin-bottom:8px}.sub{color:#9C9B99;font-size:14px;line-height:1.6}</style></head>
<body><div class="c">${success
    ? `<div class="ok">&#10003;</div><h1>Connected!</h1><p class="sub">Signed in as <strong>${detail || 'OpenAI'}</strong>.<br>You can close this tab and go back to the wizard.</p>`
    : `<div class="err">&#10007;</div><h1>Error</h1><p class="sub">${detail}<br>Close this tab and try again in the wizard.</p>`
  }</div></body></html>`;
  res.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

// GET /api/auth/openai/status — polling endpoint for frontend
function handleOAuthStatus(req, res) {
  if (oauthResult && oauthResult.success) {
    sendJSON(res, 200, { done: true, email: oauthResult.email });
  } else {
    sendJSON(res, 200, { done: false });
  }
}

// POST /api/auth/openai/exchange — manual fallback (user pastes callback URL)
async function handleOAuthExchange(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data || !data.callbackUrl) {
    sendError(res, 400, 'Missing callbackUrl');
    return;
  }

  if (!pkceSession) {
    sendError(res, 400, 'No OAuth session active. Start the flow again.');
    return;
  }

  // Parse the callback URL to extract the auth code
  let code = null;
  try {
    const url = new URL(data.callbackUrl);
    code = url.searchParams.get('code');
  } catch {}
  if (!code && data.callbackUrl.includes('code=')) {
    const match = data.callbackUrl.match(/[?&]code=([^&]+)/);
    if (match) code = match[1];
  }
  if (!code) {
    code = data.callbackUrl.trim();
  }

  if (!code) {
    sendError(res, 400, 'Could not extract authorization code from input');
    return;
  }

  try {
    const tokenRes = await exchangeOAuthCode(code, pkceSession.verifier, pkceSession.redirectUri);
    const { email } = processOAuthTokens(tokenRes);
    oauthResult = { success: true, email };
    pkceSession = null;
    sendJSON(res, 200, { success: true, email });
  } catch (err) {
    log(`OAuth exchange error: ${err.message}`);
    sendError(res, 500, `OAuth exchange failed: ${err.message}`);
  }
}

async function handleAnthropicToken(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data || !data.token) {
    sendError(res, 400, 'Missing token');
    return;
  }

  const token = data.token.trim();
  if (token.length < 20) {
    sendError(res, 400, 'Token too short');
    return;
  }

  // Anthropic tokens are static (no refresh needed) — store as secret
  writeSecretFile('llm_api_key', token);
  log('Anthropic token written to secrets/llm_api_key');
  sendJSON(res, 200, { success: true });
}

async function handleConfigure(req, res) {
  const body = await readBody(req);
  const data = parseJSON(body);

  if (!data) {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  // Validate required fields
  if (!data.provider) {
    sendError(res, 400, 'Missing required field: provider');
    return;
  }

  const authMode = data.authMode || 'api-key';
  if (authMode === 'api-key' && !data.apiKey) {
    sendError(res, 400, 'Missing required field: apiKey');
    return;
  }

  if (!MODEL_CATALOG[data.provider]) {
    sendError(res, 400, `Unknown provider: ${data.provider}`);
    return;
  }

  // Validate key format (only for api-key mode)
  if (authMode === 'api-key' && data.apiKey) {
    const prefix = KEY_PREFIXES[data.provider];
    if (prefix && !data.apiKey.startsWith(prefix)) {
      sendError(res, 400, `Invalid API key format for ${data.provider}`);
      return;
    }
  }

  try {
    // Ensure directories exist
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
    fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });

    // Write secrets (only for api-key mode)
    if (data.apiKey) {
      writeSecretFile('llm_api_key', data.apiKey);
    }

    // Handle telegram fields (frontend sends nested object)
    const telegram = data.telegram || {};
    if (telegram.botToken) {
      writeSecretFile('telegram_bot_token', telegram.botToken);
      // chat_id is already captured by /api/telegram/pair during wizard Step 6
    }

    // Handle optional features (voice transcription, web search)
    const features = data.features || {};
    if (features.voice && features.voice.enabled && features.voice.apiKey) {
      writeSecretFile('groq_api_key', features.voice.apiKey);
    }
    if (features.webSearch && features.webSearch.enabled && features.webSearch.apiKey) {
      writeSecretFile('brave_api_key', features.webSearch.apiKey);
    }

    const gatewayToken = ensureGatewayToken();

    // Build env vars (excluding secrets)
    const modelName = data.model || data.modelName || MODEL_CATALOG[data.provider].defaultModel;
    const envVars = {
      CLI_LANGUAGE:               data.language || 'en',
      AUTH_MODE:                  data.authMode || 'api-key',
      MODEL_PROVIDER:             data.provider,
      MODEL_NAME:                 modelName,
      LIMBO_PORT:                 String(PORT),
      TELEGRAM_ENABLED:           telegram.enabled ? 'true' : 'false',
      VOICE_ENABLED:              (features.voice && features.voice.enabled) ? 'true' : 'false',
      WEB_SEARCH_ENABLED:         (features.webSearch && features.webSearch.enabled) ? 'true' : 'false',
    };

    // Write .env file (quote values to handle special chars)
    const envContent = Object.entries(envVars)
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n') + '\n';
    fs.writeFileSync(ENV_FILE, envContent, { mode: 0o600 });

    // Remove setup token — wizard is done
    try { fs.unlinkSync(SETUP_TOKEN_FILE); } catch { /* ignore */ }

    log(`Configuration written: provider=${data.provider} model=${modelName}`);
    sendJSON(res, 200, { success: true });

    // Keep serving the success page for a bit, then exit for container restart
    setTimeout(() => {
      log('Configuration complete. Exiting for container restart...');
      process.exit(0);
    }, 10000);

  } catch (err) {
    log(`Configure error: ${err.message}`);
    sendError(res, 500, 'Failed to write configuration');
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const { method, url } = req;
  log(`${method} ${url}`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent Cloudflare edge + browser disk cache from serving stale responses.
  // Quick tunnels (trycloudflare.com) cache static assets by default (120min TTL).
  // Chrome aggressively caches 403/301 responses, breaking revisits after token changes.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // OAuth callback bypass — no token needed (PKCE verifier is the security)
  if (method === 'GET' && url.startsWith('/auth/callback')) {
    try {
      await handleOAuthCallback(req, res);
    } catch (err) {
      log(`OAuth callback error: ${err.message}`);
      if (!res.headersSent) serveCallbackPage(res, false, 'Internal error');
    }
    return;
  }

  // Token check — every request must have a valid setup token
  if (!checkToken(req)) {
    log(`WARN  Rejected request without valid token: ${method} ${url}`);
    if (method === 'GET' && !url.startsWith('/api/')) {
      sendForbidden(res);
    } else {
      sendError(res, 403, 'Invalid or missing setup token');
    }
    return;
  }

  try {
    if (method === 'GET' && url.startsWith('/api/models')) {
      handleGetModels(req, res);
    } else if (method === 'POST' && url === '/api/validate-key') {
      await handleValidateKey(req, res);
    } else if (method === 'GET' && url.startsWith('/api/auth/openai/start')) {
      handleOAuthStart(req, res);
    } else if (method === 'GET' && url.startsWith('/api/auth/openai/status')) {
      handleOAuthStatus(req, res);
    } else if (method === 'POST' && url === '/api/auth/openai/exchange') {
      await handleOAuthExchange(req, res);
    } else if (method === 'POST' && url === '/api/auth/anthropic/token') {
      await handleAnthropicToken(req, res);
    } else if (method === 'POST' && url === '/api/telegram/validate-token') {
      await handleTelegramValidate(req, res);
    } else if (method === 'POST' && url === '/api/telegram/pair') {
      await handleTelegramPair(req, res);
    } else if (method === 'POST' && url === '/api/configure') {
      await handleConfigure(req, res);
    } else if (method === 'GET') {
      serveStatic(req, res);
    } else {
      sendError(res, 405, 'Method not allowed');
    }
  } catch (err) {
    log(`Request error: ${err.message}`);
    if (!res.headersSent) {
      sendError(res, 500, 'Internal server error');
    }
  }
}

// ─── Exports (for testing) ────────────────────────────────────────────────────

module.exports = {
  MODEL_CATALOG,
  KEY_PREFIXES,
  MIME_TYPES,
  parseJSON,
  generatePKCE,
  buildOAuthUrl,
  decodeJwtPayload,
  buildCodexAuthProfile,
  handleRequest,
  _internals: {
    OPENAI_OAUTH,
    readBody,
    sendJSON,
    sendError,
    checkToken,
    writeSecretFile,
    readSecretFile,
    ensureGatewayToken,
    ensureSetupToken,
    writeAuthProfiles,
  },
};

// ─── Server ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, '0.0.0.0', () => {
    log(`Limbo Setup Wizard listening on port ${PORT}`);
    log(`SETUP_URL=http://127.0.0.1:${PORT}/?token=${SETUP_TOKEN}`);
    log('Share the URL above with the user to complete setup.');
  });

  server.on('error', (err) => {
    log(`Server error: ${err.message}`);
    process.exit(1);
  });
}
