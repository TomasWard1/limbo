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
# Priority: /run/secrets/ (Docker secrets) > ZeroClaw secrets (wizard-written) > env vars
read_secret() {
  local docker_secret="/run/secrets/$1"
  local zc_secret="${ZEROCLAW_STATE_DIR:-/home/limbo/.zeroclaw}/secrets/$1"
  if [ -f "$docker_secret" ] && [ -s "$docker_secret" ] && [ -r "$docker_secret" ]; then
    cat "$docker_secret"
  elif [ -f "$zc_secret" ] && [ -s "$zc_secret" ] && [ -r "$zc_secret" ]; then
    cat "$zc_secret"
  else
    echo ""
  fi
}

# API key auth is optional now because ZeroClaw can also use persisted auth profiles.
# Prefer Docker secrets, fall back to env vars for backwards compatibility.
_secret_llm="$(read_secret llm_api_key)"
_secret_telegram="$(read_secret telegram_bot_token)"

LLM_API_KEY="${_secret_llm:-${LLM_API_KEY:-}}"

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-opus-4-6}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${_secret_telegram:-${TELEGRAM_BOT_TOKEN:-}}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ZEROCLAW_STATE_DIR="${ZEROCLAW_STATE_DIR:-/home/limbo/.zeroclaw}"
ZEROCLAW_CONFIG_PATH="${ZEROCLAW_CONFIG_PATH:-$ZEROCLAW_STATE_DIR/config.toml}"

if [ "$MODEL_PROVIDER" = "openai" ] && [ -n "$LLM_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  OPENAI_API_KEY="$LLM_API_KEY"
fi

if [ "$MODEL_PROVIDER" = "anthropic" ] && [ -n "$LLM_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  ANTHROPIC_API_KEY="$LLM_API_KEY"
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
# Subscription mode uses OAuth tokens stored in ZeroClaw auth-profiles — no API key needed.
# Setup mode skips validation entirely — the wizard will configure keys.
AUTH_MODE="${AUTH_MODE:-api-key}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping API key validation"
elif [ "$AUTH_MODE" = "subscription" ]; then
  log "INFO  Subscription mode — using ZeroClaw auth profiles (no API key required)"
  # Export any API keys that happen to exist, but don't require them
  [ -n "$LLM_API_KEY" ] && export OPENAI_API_KEY="${OPENAI_API_KEY:-$LLM_API_KEY}"
  [ -n "$LLM_API_KEY" ] && export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$LLM_API_KEY}"
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
ZC_SECRETS="$ZEROCLAW_STATE_DIR/secrets"
mkdir -p /data/vault/notes /data/vault/maps /data/config "$ZEROCLAW_STATE_DIR" "$ZC_SECRETS"

# Sync Docker secrets into ZeroClaw state dir.
# Docker mounts secrets as read-only in /run/secrets/; we copy to a writable path.
for secret_name in gateway_token llm_api_key telegram_bot_token; do
  src="/run/secrets/$secret_name"
  dst="$ZC_SECRETS/$secret_name"
  if [ -f "$src" ] && [ -s "$src" ]; then
    cp "$src" "$dst"
  fi
done

# ── Bootstrap workspace (ZeroClaw native) ─────────────────────────────────────
# All workspace files live directly in $ZEROCLAW_STATE_DIR/workspace/.
# System files are copied from the image on every boot (immutable source of truth).
# User-seeded files are only written on first run (agent can modify them).
ZC_WORKSPACE="$ZEROCLAW_STATE_DIR/workspace"
mkdir -p "$ZC_WORKSPACE"

# System files: copy from image on every boot (overwrite — image is source of truth)
for f in /app/workspace/system/*.md; do
  [ -f "$f" ] || continue
  cp "$f" "$ZC_WORKSPACE/$(basename "$f")"
done
log "INFO  System workspace files copied to ZeroClaw workspace"

# User files: seed from templates only on first run (never overwrite)
for f in /app/workspace/templates/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  [ "$fname" = "USER.md.template" ] && continue
  target="$ZC_WORKSPACE/$fname"
  if [ ! -f "$target" ]; then
    cp "$f" "$target"
    log "INFO  Seeded user file: $fname"
  fi
done

# USER.md: generate from template via envsubst on first run
if [ ! -f "$ZC_WORKSPACE/USER.md" ]; then
  export USER_NAME USER_TIMEZONE USER_LANGUAGE USER_CONTEXT
  envsubst '$USER_NAME $USER_TIMEZONE $USER_LANGUAGE $USER_CONTEXT' \
    < /app/workspace/templates/USER.md.template > "$ZC_WORKSPACE/USER.md"
  log "INFO  Generated USER.md from template"
fi

# ── Generate ZeroClaw config ──────────────────────────────────────────────────
# Skip in setup mode (wizard hasn't configured anything yet).
# Always regenerate from template so config.toml reflects the latest .env values.
LIMBO_PORT="${LIMBO_PORT:-18789}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping config generation"
else
  # Subscription (OAuth) mode uses "openai-codex" provider, not "openai".
  # The wizard saves MODEL_PROVIDER=openai in .env, but ZeroClaw's auth-profiles
  # use "openai-codex" for OAuth-based auth. Remap here so config.toml matches.
  if [ "$AUTH_MODE" = "subscription" ] && [ "$MODEL_PROVIDER" = "openai" ]; then
    MODEL_PROVIDER="openai-codex"
    log "INFO  Subscription mode: remapped provider openai → openai-codex"
  fi

  log "INFO  Generating ZeroClaw config from template"
  export MODEL_PROVIDER MODEL_NAME LIMBO_PORT
  envsubst '$MODEL_PROVIDER $MODEL_NAME $LIMBO_PORT' \
    < /app/config.toml.template > "$ZEROCLAW_CONFIG_PATH"

  # Telegram: channel is enabled by section presence, not a boolean flag.
  # Only append [channels_config.telegram] when the user actually configured it.
  if [ "$TELEGRAM_ENABLED" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    cat >> "$ZEROCLAW_CONFIG_PATH" <<TELEGRAM_EOF

[channels_config]
ack_reactions = false

[channels_config.telegram]
bot_token = "$TELEGRAM_BOT_TOKEN"
allowed_users = ["*"]
TELEGRAM_EOF
    log "INFO  Telegram channel enabled in config"
  fi

  log "INFO  ZeroClaw config written to $ZEROCLAW_CONFIG_PATH"
fi

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Export state dir for ZeroClaw ─────────────────────────────────────────────
export ZEROCLAW_STATE_DIR
export ZEROCLAW_CONFIG_PATH

# ── Setup mode: start wizard instead of ZeroClaw ─────────────────────────────
# When setup completes, the server exits and Docker restarts the container.
# On restart, /data/config/.env exists → normal startup path.
if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  No configuration found — starting setup wizard on port $LIMBO_PORT"
  exec node /app/setup-server/server.js
fi

# ── Start ZeroClaw daemon ────────────────────────────────────────────────────
log "INFO  Starting ZeroClaw daemon"
exec zeroclaw daemon
