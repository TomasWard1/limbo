#!/bin/sh
# entrypoint.sh — Limbo container startup (runs as user limbo)
set -e

LOG_DIR="/data/logs"
LOG_FILE="$LOG_DIR/startup.log"

# ── Logging ──────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

log() {
  msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

log "INFO  Limbo container starting"

# ── Read secrets ──────────────────────────────────────────────────────────────
# Priority: /run/secrets/ (Docker secrets) > OpenClaw secrets (wizard-written) > env vars
read_secret() {
  local docker_secret="/run/secrets/$1"
  local oc_secret="${OPENCLAW_STATE_DIR:-/home/limbo/.openclaw}/secrets/$1"
  if [ -f "$docker_secret" ] && [ -s "$docker_secret" ] && [ -r "$docker_secret" ]; then
    cat "$docker_secret"
  elif [ -f "$oc_secret" ] && [ -s "$oc_secret" ] && [ -r "$oc_secret" ]; then
    cat "$oc_secret"
  else
    echo ""
  fi
}

# API key auth is optional now because OpenClaw can also use persisted auth profiles.
# Prefer Docker secrets, fall back to env vars for backwards compatibility.
_secret_llm="$(read_secret llm_api_key)"
_secret_telegram="$(read_secret telegram_bot_token)"

LLM_API_KEY="${_secret_llm:-${LLM_API_KEY:-}}"

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-opus-4-6}"
RUNTIME_REASONING_EFFORT="${RUNTIME_REASONING_EFFORT:-medium}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${_secret_telegram:-${TELEGRAM_BOT_TOKEN:-}}"
VOICE_ENABLED="${VOICE_ENABLED:-false}"
WEB_SEARCH_ENABLED="${WEB_SEARCH_ENABLED:-false}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/limbo/.openclaw}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"

if [ "$MODEL_PROVIDER" = "openai" ] && [ -n "$LLM_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  OPENAI_API_KEY="$LLM_API_KEY"
fi

if [ "$MODEL_PROVIDER" = "anthropic" ] && [ -n "$LLM_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  ANTHROPIC_API_KEY="$LLM_API_KEY"
fi

# ── Handle forced reconfiguration ────────────────────────────────────────────
# CLI sets FORCE_SETUP_MODE=true via env_file when --reconfigure is used.
# This is more reliable than running `docker compose run` to delete files,
# which can fail silently due to volume permissions or Docker state.
# FORCE_SETUP_MODE is baked into container env vars at creation time (docker
# compose env_file). It persists across restarts even after the CLI removes it
# from the host .env, because Docker doesn't re-read env_file on restart.
# Use a marker file so we only clear config on the FIRST boot, not on the
# automatic restart after the wizard writes new config.
FORCE_DONE_MARKER="/data/.force-setup-done"
if [ "${FORCE_SETUP_MODE:-}" = "true" ] && [ ! -f "$FORCE_DONE_MARKER" ]; then
  log "INFO  FORCE_SETUP_MODE requested — clearing config for reconfiguration"
  rm -f /data/config/.env "$OPENCLAW_CONFIG_PATH"
  touch "$FORCE_DONE_MARKER"
fi

# ── Detect setup mode (no config yet → wizard will handle everything) ────────
SETUP_MODE=false
if [ ! -f /data/config/.env ]; then
  SETUP_MODE=true
else
  # Source wizard-generated config (written by setup-server on first run)
  set -a
  . /data/config/.env
  set +a
  log "INFO  Loaded config from /data/config/.env"
fi

# ── Validate and resolve API key ─────────────────────────────────────────────
# Setup mode skips validation entirely — the wizard will configure keys.
AUTH_MODE="${AUTH_MODE:-api-key}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping API key validation"
elif [ "$AUTH_MODE" = "subscription" ]; then
  log "INFO  Subscription mode — credentials resolved from secrets"
  # Subscription tokens are stored as secrets (same path as api-key mode).
  # The wizard writes the token to secrets/llm_api_key during setup.
  # read_secret already loaded it into LLM_API_KEY above.
  case "$MODEL_PROVIDER" in
    anthropic)
      if [ -n "$LLM_API_KEY" ]; then
        # OAuth tokens (sk-ant-oat*) need ANTHROPIC_OAUTH_TOKEN so OpenClaw
        # routes them through its OAuth adapter instead of the API key path.
        case "$LLM_API_KEY" in
          sk-ant-oat*)
            export ANTHROPIC_OAUTH_TOKEN="${ANTHROPIC_OAUTH_TOKEN:-$LLM_API_KEY}"
            log "INFO  Exported Anthropic OAuth token"
            ;;
          *)
            export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$LLM_API_KEY}"
            ;;
        esac
      fi
      ;;
    openai|openai-codex)
      [ -n "$LLM_API_KEY" ] && export OPENAI_API_KEY="${OPENAI_API_KEY:-$LLM_API_KEY}"
      ;;
  esac
else
  # API-key mode: require LLM_API_KEY or provider-specific key
  case "$MODEL_PROVIDER" in
    openrouter)
      LLM_API_KEY="${LLM_API_KEY:-${OPENROUTER_API_KEY:-}}"
      if [ -z "$LLM_API_KEY" ]; then
        log "ERROR LLM_API_KEY (or OPENROUTER_API_KEY) is required for MODEL_PROVIDER=openrouter"
        exit 1
      fi
      export OPENROUTER_API_KEY="$LLM_API_KEY"
      ;;
    openai)
      LLM_API_KEY="${LLM_API_KEY:-${OPENAI_API_KEY:-}}"
      if [ -z "$LLM_API_KEY" ]; then
        log "ERROR LLM_API_KEY (or OPENAI_API_KEY) is required for MODEL_PROVIDER=openai"
        exit 1
      fi
      export OPENAI_API_KEY="$LLM_API_KEY"
      ;;
    *)
      LLM_API_KEY="${LLM_API_KEY:-${ANTHROPIC_API_KEY:-}}"
      if [ -z "$LLM_API_KEY" ]; then
        log "ERROR LLM_API_KEY (or ANTHROPIC_API_KEY for backwards compat) is required"
        exit 1
      fi
      export ANTHROPIC_API_KEY="$LLM_API_KEY"
      ;;
  esac
fi

# ── Bootstrap data dirs ───────────────────────────────────────────────────────
OC_SECRETS="$OPENCLAW_STATE_DIR/secrets"
OC_CRON="$OPENCLAW_STATE_DIR/cron"
mkdir -p /data/vault/notes /data/vault/maps /data/vault/assets /data/config "$OPENCLAW_STATE_DIR" "$OC_SECRETS" "$OC_CRON"

# Sync Docker secrets into OpenClaw state dir.
# Docker mounts secrets as read-only in /run/secrets/; we copy to a writable path.
# Note: Docker Compose file-based secrets ignore uid/gid/mode settings,
# so files may be owned by a different user. Use cp || true to tolerate
# permission errors (e.g. during setup mode when secrets are placeholder files).
for secret_name in gateway_token llm_api_key telegram_bot_token groq_api_key brave_api_key; do
  src="/run/secrets/$secret_name"
  dst="$OC_SECRETS/$secret_name"
  if [ -f "$src" ] && [ -s "$src" ] && [ -r "$src" ]; then
    cp "$src" "$dst"
  fi
done

# ── Bootstrap workspace (OpenClaw native) ─────────────────────────────────────
# All workspace files live directly in $OPENCLAW_STATE_DIR/workspace/.
# System files (AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, limbo-skill.md) are
# copied from the image on every boot (immutable source of truth).
# User files (USER.md) are seeded from template on first run only.
OC_WORKSPACE="$OPENCLAW_STATE_DIR/workspace"
OC_AGENT_DIR="$OPENCLAW_STATE_DIR/agents/main/agent"
mkdir -p "$OC_WORKSPACE" "$OC_WORKSPACE/memory" "$OC_AGENT_DIR/memory"
# MEMORY.md required by OpenClaw's session-memory hook in both workspace and agentDir
[ -f "$OC_WORKSPACE/MEMORY.md" ] || touch "$OC_WORKSPACE/MEMORY.md"
[ -f "$OC_AGENT_DIR/memory/MEMORY.md" ] || touch "$OC_AGENT_DIR/memory/MEMORY.md"

# System files: copy from image on every boot (overwrite — image is source of truth)
for f in /app/workspace/system/*.md; do
  [ -f "$f" ] || continue
  cp "$f" "$OC_WORKSPACE/$(basename "$f")"
done
log "INFO  System workspace files copied to OpenClaw workspace"

# Skills: copy from image on every boot (overwrite — image is source of truth)
if [ -d /app/workspace/skills ]; then
  mkdir -p "$OC_WORKSPACE/skills"
  for skill_dir in /app/workspace/skills/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    mkdir -p "$OC_WORKSPACE/skills/$skill_name"
    cp "$skill_dir"* "$OC_WORKSPACE/skills/$skill_name/" 2>/dev/null
  done
  log "INFO  Skills synced to OpenClaw workspace"
fi

# User files: seed from templates only on first run (never overwrite)
for f in /app/workspace/templates/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  [ "$fname" = "USER.md.template" ] && continue
  target="$OC_WORKSPACE/$fname"
  if [ ! -f "$target" ]; then
    cp "$f" "$target"
    log "INFO  Seeded user file: $fname"
  fi
done

# USER.md migration: regenerate if stale template syntax detected (issue #243)
if [ -f "$OC_WORKSPACE/USER.md" ] && grep -q '${' "$OC_WORKSPACE/USER.md"; then
  log "WARN  USER.md contains unexpanded template syntax — regenerating from current template"
  rm "$OC_WORKSPACE/USER.md"
fi

# USER.md: generate from template via envsubst on first run
if [ ! -f "$OC_WORKSPACE/USER.md" ]; then
  USER_NAME="${USER_NAME:-User}"
  USER_TIMEZONE="${USER_TIMEZONE:-}"
  USER_LANGUAGE="${USER_LANGUAGE:-English}"
  USER_CONTEXT="${USER_CONTEXT:-No additional context provided.}"
  export USER_NAME USER_TIMEZONE USER_LANGUAGE USER_CONTEXT
  envsubst '$USER_NAME $USER_TIMEZONE $USER_LANGUAGE $USER_CONTEXT' \
    < /app/workspace/templates/USER.md.template > "$OC_WORKSPACE/USER.md"
  log "INFO  Generated USER.md from template"
fi

# ── Set container timezone ───────────────────────────────────────────────────
# Match the container's TZ to the user's timezone so that system time, schedule
# tool, and cron expressions all operate in local time. Without this, the system
# clock reports UTC and relative-time reminders ("in 3 hours") land at the wrong
# wall-clock time — the agent or OpenClaw applies the UTC offset twice.
if [ -n "${USER_TIMEZONE:-}" ]; then
  export TZ="$USER_TIMEZONE"
  log "INFO  Container timezone set to $TZ"
else
  log "WARN  USER_TIMEZONE not set — container defaults to UTC"
fi

# ── Generate OpenClaw config ─────────────────────────────────────────────────
# Skip in setup mode (wizard hasn't configured anything yet).
# Always regenerate from template so openclaw.json reflects the latest .env values.
LIMBO_PORT="${LIMBO_PORT:-18789}"

# Read gateway token from secrets
_secret_gateway="$(read_secret gateway_token)"
GATEWAY_TOKEN="${_secret_gateway:-${GATEWAY_TOKEN:-}}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping config generation"
else
  # Subscription (OAuth) mode uses "openai-codex" provider, not "openai".
  # The wizard saves MODEL_PROVIDER=openai in .env, but OpenClaw's auth-profiles
  # use "openai-codex" for OAuth-based auth. Remap here so config matches.
  if [ "$AUTH_MODE" = "subscription" ] && [ "$MODEL_PROVIDER" = "openai" ]; then
    MODEL_PROVIDER="openai-codex"
    log "INFO  Subscription mode: remapped provider openai → openai-codex"
  fi

  log "INFO  Generating OpenClaw config from template"
  export MODEL_PROVIDER MODEL_NAME LIMBO_PORT RUNTIME_REASONING_EFFORT OPENCLAW_STATE_DIR
  envsubst '$MODEL_PROVIDER $MODEL_NAME $LIMBO_PORT $RUNTIME_REASONING_EFFORT $OPENCLAW_STATE_DIR' \
    < /app/openclaw.json.template > "$OPENCLAW_CONFIG_PATH"

  # Inject gateway token via node to safely handle special characters in tokens
  export GATEWAY_TOKEN
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    cfg.gateway.auth.token = process.env.GATEWAY_TOKEN || '';
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$OPENCLAW_CONFIG_PATH"

  # Telegram: channel is enabled by section presence, not a boolean flag.
  # Only merge telegram config when the user actually configured it.
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
    " "$OPENCLAW_CONFIG_PATH"
    log "INFO  Telegram channel enabled in config"
  fi

  # Voice transcription (Groq Whisper)
  # OpenClaw auto-detects GROQ_API_KEY from env — no config injection needed.
  _secret_groq="$(read_secret groq_api_key)"
  GROQ_API_KEY="${_secret_groq:-${GROQ_API_KEY:-}}"

  if [ "$VOICE_ENABLED" = "true" ] && [ -n "$GROQ_API_KEY" ]; then
    export GROQ_API_KEY
    log "INFO  Voice transcription enabled (GROQ_API_KEY exported)"
  fi

  # Web search (Brave)
  # OpenClaw schema: tools.web.search with provider and env-based API key.
  _secret_brave="$(read_secret brave_api_key)"
  BRAVE_API_KEY="${_secret_brave:-${BRAVE_API_KEY:-}}"

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
      fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
    " "$OPENCLAW_CONFIG_PATH"
    log "INFO  Web search enabled in config (BRAVE_API_KEY exported)"
  fi

  log "INFO  OpenClaw config written to $OPENCLAW_CONFIG_PATH"
fi

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Check workspace ownership ────────────────────────────────────────────────
# OpenClaw runs as uid=limbo but volumes persisted from older images may contain
# files owned by a different user (e.g. node:node). Detect and warn — the
# container can't chown without root, so we fail fast with a clear message.
WORKSPACE_DIR="${OPENCLAW_STATE_DIR}/workspace"
if [ -d "$WORKSPACE_DIR" ]; then
  bad_file="$(find "$WORKSPACE_DIR" -not -user "$(id -u)" -print -quit 2>/dev/null)"
  if [ -n "$bad_file" ]; then
    log "ERROR Files in $WORKSPACE_DIR are not owned by limbo (uid=$(id -u))."
    log "ERROR Example: $(ls -ln "$bad_file" 2>/dev/null | head -1)"
    log "ERROR Fix from host: docker exec -u root <container> chown -R $(id -u):$(id -g) $WORKSPACE_DIR"
    log "WARN  Continuing anyway — OpenClaw may fail to write to some files"
  fi
fi

# ── Export state dir for OpenClaw ─────────────────────────────────────────────
export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_PATH

# ── Setup mode: start wizard instead of OpenClaw ─────────────────────────────
# When setup completes, the server exits and Docker restarts the container.
# On restart, /data/config/.env exists → normal startup path.
if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  No configuration found — starting setup wizard on port $LIMBO_PORT"
  exec node /app/setup-server/server.js
fi

# ── Clean up force-setup marker ──────────────────────────────────────────────
# If we reach here, config exists and OpenClaw is about to start normally.
# Remove the marker so that the NEXT --reconfigure will work.
rm -f "$FORCE_DONE_MARKER"

# ── Start OpenClaw gateway ───────────────────────────────────────────────────
log "INFO  Starting OpenClaw gateway"
exec openclaw gateway
