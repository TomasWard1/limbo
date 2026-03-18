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

# ── Read Docker secrets (with env var fallback for backwards compat) ──────────
# Priority: /run/secrets/ (Docker secrets) > /data/secrets/ (wizard-written) > env vars
read_secret() {
  local docker_secret="/run/secrets/$1"
  local wizard_secret="/data/secrets/$1"
  # Check Docker secrets first, but only if non-empty and readable
  if [ -f "$docker_secret" ] && [ -s "$docker_secret" ] && [ -r "$docker_secret" ]; then
    cat "$docker_secret"
  elif [ -f "$wizard_secret" ] && [ -s "$wizard_secret" ] && [ -r "$wizard_secret" ]; then
    cat "$wizard_secret"
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
TELEGRAM_AUTO_PAIR_FIRST_DM="${TELEGRAM_AUTO_PAIR_FIRST_DM:-false}"
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
mkdir -p /data/db /data/backups /data/logs /data/vault/notes /data/vault/maps /data/config /data/secrets "$ZEROCLAW_STATE_DIR"

# ── Bootstrap workspace (layered: system symlinks + user seeds) ──────────────
mkdir -p /data/workspace

# System files: symlink from read-only image on every boot.
# Even if the agent or user deleted/modified these, they get restored.
# Symlink targets are on read-only root FS — immutable at runtime.
for f in /app/workspace/system/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  target="/data/workspace/$fname"
  if [ -f "$target" ] && [ ! -L "$target" ]; then
    log "WARN  System file $fname was replaced — restoring from image"
  fi
  ln -sf "$f" "$target"
done
log "INFO  System workspace files linked from image"

# User files: seed from templates only on first run (never overwrite).
# These are owned by limbo and writable by the agent.
for f in /app/workspace/templates/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  # Skip the USER.md.template — handled separately via envsubst
  [ "$fname" = "USER.md.template" ] && continue
  target="/data/workspace/$fname"
  if [ ! -f "$target" ]; then
    cp "$f" "$target"
    log "INFO  Seeded user file: $fname"
  fi
done

# USER.md: generate from template via envsubst on first run
if [ ! -f /data/workspace/USER.md ]; then
  export USER_NAME USER_TIMEZONE USER_LANGUAGE USER_CONTEXT
  envsubst '$USER_NAME $USER_TIMEZONE $USER_LANGUAGE $USER_CONTEXT' \
    < /app/workspace/templates/USER.md.template > /data/workspace/USER.md
  log "INFO  Generated USER.md from template"
fi

# ── Generate ZeroClaw config only if one does not exist already ───────────────
if [ ! -f "$ZEROCLAW_CONFIG_PATH" ]; then
  log "INFO  No persisted ZeroClaw config found — generating fallback config"
  export MODEL_PROVIDER MODEL_NAME TELEGRAM_ENABLED TELEGRAM_BOT_TOKEN OPENAI_API_KEY ANTHROPIC_API_KEY ZEROCLAW_STATE_DIR ZEROCLAW_CONFIG_PATH LIMBO_PORT
  envsubst '$MODEL_PROVIDER $MODEL_NAME $TELEGRAM_ENABLED $TELEGRAM_BOT_TOKEN $LIMBO_PORT' \
    < /app/config.toml.template > "$ZEROCLAW_CONFIG_PATH"
  log "INFO  ZeroClaw config written to $ZEROCLAW_CONFIG_PATH"
else
  log "INFO  Using persisted ZeroClaw config at $ZEROCLAW_CONFIG_PATH"
fi

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Export state dir for ZeroClaw ─────────────────────────────────────────────
export ZEROCLAW_STATE_DIR
export ZEROCLAW_CONFIG_PATH

# ── Telegram auto-pair (simplified for ZeroClaw) ─────────────────────────────
if [ "$TELEGRAM_ENABLED" = "true" ] && [ "$TELEGRAM_AUTO_PAIR_FIRST_DM" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  SENTINEL_FILE="/data/config/telegram-first-pairing.done"
  if [ -f "$SENTINEL_FILE" ]; then
    log "INFO  Telegram first-pair bootstrap already completed"
  else
    log "INFO  Telegram auto-accept configured via ZeroClaw allowed_users"
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$SENTINEL_FILE"
  fi
fi

# ── Setup mode: start wizard instead of ZeroClaw ─────────────────────────────
# When setup completes, the server exits and Docker restarts the container.
# On restart, /data/config/.env exists → normal startup path.
LIMBO_PORT="${LIMBO_PORT:-18789}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  No configuration found — starting setup wizard on port $LIMBO_PORT"
  exec node /app/setup-server/server.js
fi

# ── Start ZeroClaw daemon ────────────────────────────────────────────────────
log "INFO  Starting ZeroClaw daemon"
exec zeroclaw daemon
