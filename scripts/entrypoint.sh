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

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-sonnet-4-6}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_AUTO_PAIR_FIRST_DM="${TELEGRAM_AUTO_PAIR_FIRST_DM:-true}"

# ── Validate and resolve API key ─────────────────────────────────────────────
# Accept LLM_API_KEY (generic) or ANTHROPIC_API_KEY (backwards compat).
# For OpenRouter, also accept OPENROUTER_API_KEY directly.
case "$MODEL_PROVIDER" in
  openrouter)
    # Prefer explicit OPENROUTER_API_KEY, then fall back to LLM_API_KEY
    LLM_API_KEY="${LLM_API_KEY:-${OPENROUTER_API_KEY:-}}"
    if [ -z "$LLM_API_KEY" ]; then
      log "ERROR LLM_API_KEY (or OPENROUTER_API_KEY) is required for MODEL_PROVIDER=openrouter"
      exit 1
    fi
    export OPENROUTER_API_KEY="$LLM_API_KEY"
    ;;
  openai)
    # Prefer explicit OPENAI_API_KEY, then fall back to LLM_API_KEY
    LLM_API_KEY="${LLM_API_KEY:-${OPENAI_API_KEY:-}}"
    if [ -z "$LLM_API_KEY" ]; then
      log "ERROR LLM_API_KEY (or OPENAI_API_KEY) is required for MODEL_PROVIDER=openai"
      exit 1
    fi
    export OPENAI_API_KEY="$LLM_API_KEY"
    ;;
  *)
    # anthropic (default) — accept LLM_API_KEY or legacy ANTHROPIC_API_KEY
    LLM_API_KEY="${LLM_API_KEY:-${ANTHROPIC_API_KEY:-}}"
    if [ -z "$LLM_API_KEY" ]; then
      log "ERROR LLM_API_KEY (or ANTHROPIC_API_KEY for backwards compat) is required"
      exit 1
    fi
    export ANTHROPIC_API_KEY="$LLM_API_KEY"
    ;;
esac

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

# ── Point OpenClaw at our rendered config ─────────────────────────────────────
export OPENCLAW_CONFIG_PATH=/app/openclaw.json

# ── Gateway auth token (generate if not pre-set) ─────────────────────────────
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)"
  log "INFO  Generated OPENCLAW_GATEWAY_TOKEN (not pre-set)"
fi
export OPENCLAW_GATEWAY_TOKEN

start_telegram_auto_pair_worker() {
  [ "$TELEGRAM_ENABLED" = "true" ] || return 0
  [ "$TELEGRAM_AUTO_PAIR_FIRST_DM" = "true" ] || return 0
  [ -n "$TELEGRAM_BOT_TOKEN" ] || return 0

  SENTINEL_FILE="/data/config/telegram-first-pairing.done"
  if [ -f "$SENTINEL_FILE" ]; then
    log "INFO  Telegram first-pair bootstrap already completed"
    return 0
  fi

  (
    log "INFO  Telegram first-pair bootstrap worker started"
    ATTEMPTS=90
    for i in $(seq 1 "$ATTEMPTS"); do
      json="$(openclaw pairing list telegram --json 2>/dev/null || true)"
      if [ -z "$json" ]; then
        sleep 2
        continue
      fi

      code="$(printf '%s' "$json" | node -e "
        const fs=require('fs');
        const s=fs.readFileSync(0,'utf8');
        try{
          const j=JSON.parse(s);
          const req=(j && Array.isArray(j.requests) && j.requests[0]) ? j.requests[0] : null;
          if (!req) process.exit(1);
          const direct=req.code || req.pairingCode || req.requestCode || req.id || '';
          if (direct) { process.stdout.write(String(direct)); process.exit(0); }
          const vals=Object.values(req).map(v=>String(v||''));
          const guess=vals.find(v=>/^[A-Za-z0-9_-]{4,}$/.test(v));
          if (guess) { process.stdout.write(guess); process.exit(0); }
          process.exit(1);
        } catch { process.exit(1); }
      " 2>/dev/null || true)"

      if [ -n "$code" ]; then
        if openclaw pairing approve telegram "$code" --notify >/dev/null 2>&1; then
          log "INFO  Telegram first-pair bootstrap approved pairing code"
          date -u '+%Y-%m-%dT%H:%M:%SZ' > "$SENTINEL_FILE"
          exit 0
        else
          log "WARN  Telegram first-pair bootstrap failed to approve pairing code"
        fi
      fi

      sleep 2
    done

    log "WARN  Telegram first-pair bootstrap timed out without pending requests"
  ) &
}

start_telegram_auto_pair_worker

# ── Start OpenClaw gateway ────────────────────────────────────────────────────
log "INFO  Starting OpenClaw gateway (token auth, loopback)"
exec openclaw gateway run --port 18789 --bind loopback
