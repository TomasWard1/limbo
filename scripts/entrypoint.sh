#!/bin/sh
# entrypoint.sh — Limbo container startup
# Runs as user 'limbo' (non-root). /data is pre-owned by limbo.
set -e

LOG_DIR="/data/logs"
LOG_FILE="$LOG_DIR/startup.log"

# ── Logging ──────────────────────────────────────────────────────────────────
# Bootstrap log dir before anything else
mkdir -p "$LOG_DIR"

log() {
  msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

log "INFO  Limbo container starting"

# ── Validate required env vars ───────────────────────────────────────────────
# Accept LLM_API_KEY (generic) or ANTHROPIC_API_KEY (backwards compat)
if [ -z "${LLM_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  log "ERROR LLM_API_KEY (or ANTHROPIC_API_KEY for backwards compat) is required"
  exit 1
fi

# Resolve to LLM_API_KEY — prefer explicit, fall back to legacy var
LLM_API_KEY="${LLM_API_KEY:-$ANTHROPIC_API_KEY}"

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-sonnet-4-6}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

# ── Bootstrap data dirs ───────────────────────────────────────────────────────
mkdir -p /data/db /data/backups /data/logs /data/vault

# ── Bootstrap workspace (first-run: seed from baked-in template) ──────────────
if [ ! -d /data/workspace ]; then
  log "INFO  First run — seeding workspace from template"
  cp -r /app/workspace /data/workspace
fi

# ── Generate openclaw.json from template ─────────────────────────────────────
log "INFO  Generating /app/openclaw.json from template"

export MODEL_PROVIDER MODEL_NAME LLM_API_KEY TELEGRAM_ENABLED TELEGRAM_BOT_TOKEN
envsubst '$MODEL_PROVIDER $MODEL_NAME $LLM_API_KEY $TELEGRAM_ENABLED $TELEGRAM_BOT_TOKEN' \
  < /app/openclaw.json.template > /app/openclaw.json

log "INFO  openclaw.json written"

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Configure mcporter ────────────────────────────────────────────────────────
export MCPORTER_CONFIG=/app/mcporter.json
log "INFO  mcporter configured — MCPORTER_CONFIG=$MCPORTER_CONFIG"

# ── Start OpenClaw gateway ────────────────────────────────────────────────────
log "INFO  Starting OpenClaw gateway"
exec openclaw serve --config /app/openclaw.json
