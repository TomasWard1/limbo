#!/bin/sh
# regen-openclaw-config.sh
#
# Rewrite $OPENCLAW_CONFIG_PATH from $OPENCLAW_CONFIG_TEMPLATE, applying the
# current values from /data/config/.env. Writes atomically (tmp + rename) so
# OpenClaw's chokidar watcher sees a single-shot change and hot-reloads the
# new config. This script is the single source of truth for openclaw.json
# generation — it is called from both entrypoint.sh (boot) and
# setup-server/server.js (after a wizard finishes writing new config).
#
# Inputs (env vars + .env file):
#   OPENCLAW_STATE_DIR       — default /home/limbo/.openclaw
#   OPENCLAW_CONFIG_PATH     — default $OPENCLAW_STATE_DIR/openclaw.json
#   OPENCLAW_CONFIG_TEMPLATE — default /app/openclaw.json.template
#   /data/config/.env        — sourced for MODEL_PROVIDER, GATEWAY_TOKEN,
#                              TELEGRAM_BOT_TOKEN, GROQ_API_KEY, BRAVE_API_KEY,
#                              feature toggles, etc.
#
# There is no /run/secrets read path: the secrets-consolidation refactor
# eliminated Docker file secrets in favour of a single .env file.
#
# Exits non-zero on any error so callers can detect regen failure.

set -e

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/limbo/.openclaw}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"
OPENCLAW_CONFIG_TEMPLATE="${OPENCLAW_CONFIG_TEMPLATE:-/app/openclaw.json.template}"

# Re-source .env so this script picks up wizard-written changes without
# relying on the caller's environment. This is the single source of truth
# for tokens after the secrets consolidation.
if [ -f /data/config/.env ]; then
  set -a
  # Only source valid KEY=VALUE lines (same guard as entrypoint.sh).
  # shellcheck disable=SC1091
  eval "$(grep -E '^[A-Za-z_][A-Za-z_0-9]*=' /data/config/.env)"
  set +a
fi

# Defaults matching entrypoint.sh
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-opus-4-6}"
RUNTIME_REASONING_EFFORT="${RUNTIME_REASONING_EFFORT:-medium}"
LIMBO_PORT="${LIMBO_PORT:-18789}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
VOICE_ENABLED="${VOICE_ENABLED:-false}"
GROQ_API_KEY="${GROQ_API_KEY:-}"
WEB_SEARCH_ENABLED="${WEB_SEARCH_ENABLED:-false}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"
GOOGLE_CALENDAR_ENABLED="${GOOGLE_CALENDAR_ENABLED:-false}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-}"
AUTH_MODE="${AUTH_MODE:-api-key}"
LLM_API_KEY="${LLM_API_KEY:-}"

# Subscription OAuth mode uses openai-codex, not openai
if [ "$AUTH_MODE" = "subscription" ] && [ "$MODEL_PROVIDER" = "openai" ]; then
  MODEL_PROVIDER="openai-codex"
fi

# Generate the base config via envsubst into a temp file (atomic write target)
TMP_CONFIG="${OPENCLAW_CONFIG_PATH}.tmp.$$"
trap 'rm -f "$TMP_CONFIG"' EXIT

export MODEL_PROVIDER MODEL_NAME LIMBO_PORT RUNTIME_REASONING_EFFORT OPENCLAW_STATE_DIR
envsubst '$MODEL_PROVIDER $MODEL_NAME $LIMBO_PORT $RUNTIME_REASONING_EFFORT $OPENCLAW_STATE_DIR' \
  < "$OPENCLAW_CONFIG_TEMPLATE" > "$TMP_CONFIG"

# Inject gateway token
export GATEWAY_TOKEN
node -e "
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  cfg.gateway.auth.token = process.env.GATEWAY_TOKEN || '';
  fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
" "$TMP_CONFIG"

# Provider API key — OpenClaw reads keys from config.env, not process env vars.
# This is critical for hot-reload after switch-brain: the supervisor's process
# env doesn't change, so the key MUST be in openclaw.json for the reloaded
# gateway to find it.
if [ "$AUTH_MODE" = "api-key" ] && [ -n "$LLM_API_KEY" ]; then
  export LLM_API_KEY MODEL_PROVIDER
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const key = process.env.LLM_API_KEY;
    const provider = process.env.MODEL_PROVIDER || 'anthropic';
    const envVarName = {
      openrouter: 'OPENROUTER_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
    }[provider] || 'ANTHROPIC_API_KEY';
    cfg.env = cfg.env || {};
    cfg.env[envVarName] = key;
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$TMP_CONFIG"
fi

# Telegram channel
if [ "$TELEGRAM_ENABLED" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  export TELEGRAM_BOT_TOKEN
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.channels = cfg.channels || {};
    cfg.channels.telegram = {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      allowFrom: ['*']
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$TMP_CONFIG"
fi

# Voice transcription (Groq) — pin audio provider to bypass the auto-resolver
if [ "$VOICE_ENABLED" = "true" ] && [ -n "$GROQ_API_KEY" ]; then
  export GROQ_API_KEY
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.tools = cfg.tools || {};
    cfg.tools.media = cfg.tools.media || {};
    cfg.tools.media.audio = cfg.tools.media.audio || {};
    cfg.tools.media.audio.models = [
      { provider: 'groq', model: 'whisper-large-v3-turbo' }
    ];
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$TMP_CONFIG"
fi

# Web search (Brave)
#
# Two parts: (1) provider config under tools.web.search, (2) push web_search
# and web_fetch into tools.allow. Step (2) is required because the base
# profile is 'minimal' — without an explicit allow entry the tools stay
# hidden even with a provider key present. web_fetch rides along so the
# agent can both search and fetch individual pages.
if [ "$WEB_SEARCH_ENABLED" = "true" ] && [ -n "$BRAVE_API_KEY" ]; then
  export BRAVE_API_KEY
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.tools = cfg.tools || {};
    cfg.tools.web = cfg.tools.web || {};
    cfg.tools.web.search = {
      enabled: true,
      provider: 'brave',
      maxResults: 5
    };
    cfg.tools.allow = Array.isArray(cfg.tools.allow) ? cfg.tools.allow : [];
    for (const t of ['web_search', 'web_fetch']) {
      if (!cfg.tools.allow.includes(t)) cfg.tools.allow.push(t);
    }
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$TMP_CONFIG"
fi

# Google Calendar (gws CLI) — inject gws env vars into the limbo-vault MCP server.
# Check the new consolidated path first, fall back to legacy secrets/ layout.
GCAL_CREDS="$OPENCLAW_STATE_DIR/google/credentials.json"
if [ ! -f "$GCAL_CREDS" ] && [ -f "$OPENCLAW_STATE_DIR/secrets/google_calendar_credentials.json" ]; then
  GCAL_CREDS="$OPENCLAW_STATE_DIR/secrets/google_calendar_credentials.json"
fi
if [ "$GOOGLE_CALENDAR_ENABLED" = "true" ] && [ -f "$GCAL_CREDS" ]; then
  export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="$GCAL_CREDS"
  export GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND="file"
  export GOOGLE_WORKSPACE_CLI_CONFIG_DIR="/tmp/gws"
  mkdir -p /tmp/gws
  # Regen runs as root (before gosu) on boot but gws runs as limbo later.
  # Without this chown, gws gets "Permission denied (os error 13)".
  chown limbo:limbo /tmp/gws 2>/dev/null || true
  export GOOGLE_CALENDAR_ENABLED

  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const srv = cfg.mcp && cfg.mcp.servers && cfg.mcp.servers['limbo-vault'];
    if (srv) {
      srv.env = srv.env || {};
      srv.env.GOOGLE_CALENDAR_ENABLED = 'true';
      srv.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
      srv.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = 'file';
      srv.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = '/tmp/gws';
    }
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$TMP_CONFIG"
fi

# Atomic rename — chokidar's awaitWriteFinish handles the short window
mv "$TMP_CONFIG" "$OPENCLAW_CONFIG_PATH"
trap - EXIT
