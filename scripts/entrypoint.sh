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
if [ -z "$ANTHROPIC_API_KEY" ]; then
  log "ERROR ANTHROPIC_API_KEY is required"
  exit 1
fi

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-sonnet-4-6}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

# ── Bootstrap log dir (migration runner needs /data/logs first) ───────────────
mkdir -p /data/db /data/backups /data/logs

# ── Generate openclaw.json from template ─────────────────────────────────────
log "INFO  Generating /app/openclaw.json from template"

sed \
  -e "s|\${MODEL_PROVIDER:-anthropic}|$MODEL_PROVIDER|g" \
  -e "s|\${MODEL_NAME:-claude-sonnet-4-6}|$MODEL_NAME|g" \
  -e "s|\${ANTHROPIC_API_KEY}|$ANTHROPIC_API_KEY|g" \
  -e "s|\${TELEGRAM_ENABLED:-false}|$TELEGRAM_ENABLED|g" \
  -e "s|\${TELEGRAM_BOT_TOKEN}|$TELEGRAM_BOT_TOKEN|g" \
  /app/openclaw.json.template > /app/openclaw.json

log "INFO  openclaw.json written"

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Start OpenClaw gateway ────────────────────────────────────────────────────
log "INFO  Starting OpenClaw gateway"
exec openclaw serve --config /app/openclaw.json
