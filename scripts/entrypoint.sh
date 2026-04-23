#!/bin/sh
# entrypoint.sh — Limbo container startup
# Runs as root. Fixes data-dir ownership, then drops to non-root limbo user
# via gosu (same pattern as PostgreSQL, Redis, and other Docker official images).
set -e

# ── Fix data-dir ownership (MUST be first) ───────────────────────────────────
# Bind-mounted dirs may be owned by the host user (uid ≠ 999). Named volumes
# may be root-owned. chown everything to limbo:limbo so the app can read/write.
# This runs before mkdir, before logging, before anything that touches /data.
if ! chown -R limbo:limbo /data /home/limbo/.openclaw /home/limbo/.npm 2>/dev/null; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] WARN  chown failed on data dirs — container may lack CHOWN capability (cap_add: [CHOWN, FOWNER, SETGID, SETUID, DAC_OVERRIDE])"
fi

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
log "INFO  Data directory ownership fixed"

# ── Migrate legacy tokens to .env ────────────────────────────────────────────
# Pre-v2026.4.3 installs stored tokens in separate files:
#   - /run/secrets/*               (Docker secrets, old compose)
#   - /home/limbo/.openclaw/secrets/* (written by setup-server inside container)
# The host CLI migration often failed because these files are root-owned.
# The container runs as root here (before gosu), so we can read everything.
_env_file="/data/config/.env"
[ -f "$_env_file" ] || touch "$_env_file"
_migrated=0
for _pair in \
  "telegram_bot_token:TELEGRAM_BOT_TOKEN" \
  "telegram_chat_id:TELEGRAM_CHAT_ID" \
  "groq_api_key:GROQ_API_KEY" \
  "brave_api_key:BRAVE_API_KEY" \
  "gateway_token:GATEWAY_TOKEN" \
  "llm_api_key:LLM_API_KEY" \
  "google_client_id:GOOGLE_CLIENT_ID" \
  "google_client_secret:GOOGLE_CLIENT_SECRET"; do
  _file="${_pair%%:*}"
  _var="${_pair##*:}"
  # Skip if already in .env
  grep -q "^${_var}=" "$_env_file" 2>/dev/null && continue
  # Search all legacy paths (first non-empty wins)
  for _dir in /run/secrets /home/limbo/.openclaw/secrets; do
    _path="$_dir/$_file"
    if [ -f "$_path" ]; then
      _val="$(cat "$_path" 2>/dev/null | tr -d '\n')"
      if [ -n "$_val" ]; then
        echo "${_var}=${_val}" >> "$_env_file"
        _migrated=$((_migrated + 1))
        break
      fi
    fi
  done
done
[ "$_migrated" -gt 0 ] && log "INFO  Migrated $_migrated token(s) from legacy secret files to .env"

# ── Load config from .env ────────────────────────────────────────────────────
# All tokens live inside /data/config/.env. Source it now so the rest of the
# script sees LLM_API_KEY / TELEGRAM_BOT_TOKEN / etc. as environment variables.
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/limbo/.openclaw}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"

if [ -f /data/config/.env ]; then
  set -a
  # Only source valid KEY=VALUE lines. Malformed .env files (comments without #,
  # free text, non-ASCII) must not crash the container under set -e.
  # shellcheck disable=SC1091
  eval "$(grep -E '^[A-Za-z_][A-Za-z_0-9]*=' /data/config/.env)"
  set +a
fi

# ── Defaults ─────────────────────────────────────────────────────────────────
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_NAME="${MODEL_NAME:-claude-opus-4-6}"
RUNTIME_REASONING_EFFORT="${RUNTIME_REASONING_EFFORT:-medium}"
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
VOICE_ENABLED="${VOICE_ENABLED:-false}"
GROQ_API_KEY="${GROQ_API_KEY:-}"
WEB_SEARCH_ENABLED="${WEB_SEARCH_ENABLED:-false}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"
GOOGLE_CALENDAR_ENABLED="${GOOGLE_CALENDAR_ENABLED:-false}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-}"
LLM_API_KEY="${LLM_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

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

# -- Handle switch-brain mode ------------------------------------------------
# CLI sets SWITCH_BRAIN_MODE=true to re-run the wizard in brain-only mode.
# Unlike FORCE_SETUP_MODE, this preserves non-brain config (Telegram, features).
SWITCH_BRAIN_MARKER="/data/.switch-brain-done"
if [ "${SWITCH_BRAIN_MODE:-}" = "true" ] && [ ! -f "$SWITCH_BRAIN_MARKER" ]; then
  log "INFO  SWITCH_BRAIN_MODE requested — clearing provider config for brain switch"
  if [ -f /data/config/.env ]; then
    sed -i \
      -e '/^AUTH_MODE=/d' \
      -e '/^MODEL_PROVIDER=/d' \
      -e '/^MODEL_NAME=/d' \
      /data/config/.env
  fi
  rm -f "$OPENCLAW_CONFIG_PATH"
  touch "$SWITCH_BRAIN_MARKER"
fi

# Connect-calendar mode used to be handled here by setting CONNECT_CALENDAR_MODE=true
# in the container env and letting the entrypoint exec the setup-server instead of
# OpenClaw. That path is gone: the host CLI now talks to the wizard supervisor over a
# TCP loopback and the supervisor spawns the setup-server as a sibling of OpenClaw.

# ── Detect setup mode (no config yet → wizard will handle everything) ────────
# Two states are treated as "setup mode": (a) no .env at all, and (b) .env
# present but without MODEL_PROVIDER (half-configured — preserve features,
# ask brain).
#
# IMPORTANT: we re-grep the file instead of checking the in-memory
# $MODEL_PROVIDER. The .env was sourced at the top of the script; an earlier
# stage (SWITCH_BRAIN_MODE) may have stripped MODEL_PROVIDER from the file
# but the value is still in this shell's memory. Trust the file, not RAM.
SETUP_MODE=false
if [ ! -f /data/config/.env ]; then
  SETUP_MODE=true
elif ! grep -q '^MODEL_PROVIDER=' /data/config/.env 2>/dev/null; then
  SETUP_MODE=true
  log "INFO  Brain config missing — entering setup mode (preserving features config)"
else
  log "INFO  Loaded config from /data/config/.env"
fi

# ── Validate and resolve API key ─────────────────────────────────────────────
# Setup mode skips validation entirely — the wizard will configure keys.
AUTH_MODE="${AUTH_MODE:-api-key}"

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping API key validation"
elif [ "$AUTH_MODE" = "subscription" ]; then
  log "INFO  Subscription mode — credentials resolved from .env"
  # Subscription tokens live in .env as LLM_API_KEY; remap to the provider
  # env var name OpenClaw / the underlying SDK expects.
  case "$MODEL_PROVIDER" in
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

# ── LiteLLM gateway override ──────────────────────────────────────────────────
# When LITELLM_ENABLED=true + LITELLM_URL is set, export the SDK-level base-URL
# env vars so OpenClaw's own HTTP clients (which read process.env at load time)
# target LiteLLM instead of the upstream provider. regen-openclaw-config.sh
# also mirrors these into openclaw.json's cfg.env for agent subprocesses.
LITELLM_ENABLED="${LITELLM_ENABLED:-false}"
LITELLM_URL="${LITELLM_URL:-}"
if [ "$LITELLM_ENABLED" = "true" ] && [ -n "$LITELLM_URL" ]; then
  # Strip trailing slashes once so downstream concatenation stays clean.
  LITELLM_URL_CLEAN="${LITELLM_URL%/}"
  case "$MODEL_PROVIDER" in
    anthropic)
      # Anthropic SDK convention: base URL excludes /v1; SDK appends /v1/messages.
      export ANTHROPIC_BASE_URL="$LITELLM_URL_CLEAN"
      ;;
    openai|openai-codex)
      # OpenAI SDK convention: base URL includes /v1; SDK appends /chat/completions.
      export OPENAI_API_BASE="$LITELLM_URL_CLEAN/v1"
      export OPENAI_BASE_URL="$LITELLM_URL_CLEAN/v1"
      ;;
    openrouter)
      export OPENROUTER_API_BASE="$LITELLM_URL_CLEAN/v1"
      ;;
  esac
fi

# ── Bootstrap data dirs ───────────────────────────────────────────────────────
OC_CRON="$OPENCLAW_STATE_DIR/cron"
mkdir -p /data/vault/notes /data/vault/maps /data/vault/assets /data/config "$OPENCLAW_STATE_DIR" "$OC_CRON"

# ── Bootstrap workspace (OpenClaw native) ─────────────────────────────────────
# All workspace files live directly in $OPENCLAW_STATE_DIR/workspace/.
# System files (AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md) are copied from
# the image on every boot (immutable source of truth).
# User files (USER.md) are seeded from template on first run only.
OC_WORKSPACE="$OPENCLAW_STATE_DIR/workspace"
OC_AGENT_DIR="$OPENCLAW_STATE_DIR/agents/main/agent"
mkdir -p "$OC_WORKSPACE" "$OC_WORKSPACE/memory" "$OC_AGENT_DIR/memory"
# MEMORY.md required by OpenClaw's session-memory hook in both workspace and agentDir
[ -f "$OC_WORKSPACE/MEMORY.md" ] || touch "$OC_WORKSPACE/MEMORY.md"
[ -f "$OC_AGENT_DIR/memory/MEMORY.md" ] || touch "$OC_AGENT_DIR/memory/MEMORY.md"

# Migrate auth-profiles from legacy ZeroClaw format/location to OpenClaw.
# ZeroClaw: stored at $OPENCLAW_STATE_DIR/auth-profiles.json with fields
#   schema_version, active_profiles, kind, access_token, refresh_token
# OpenClaw: reads from agents/main/agent/auth-profiles.json with fields
#   version, type, access, refresh
LEGACY_AUTH="$OPENCLAW_STATE_DIR/auth-profiles.json"
AGENT_AUTH="$OC_AGENT_DIR/auth-profiles.json"
if [ -f "$LEGACY_AUTH" ] && [ ! -f "$AGENT_AUTH" ]; then
  node -e "
    const fs = require('fs');
    const src = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    // Already OpenClaw format — just copy
    if (src.version && !src.schema_version) {
      fs.writeFileSync(process.argv[2], JSON.stringify(src, null, 2));
      process.exit(0);
    }
    // Convert ZeroClaw → OpenClaw format
    const out = { version: 1, profiles: {} };
    for (const [id, p] of Object.entries(src.profiles || {})) {
      out.profiles[id] = {
        type: p.kind || 'oauth',
        provider: p.provider || 'openai-codex',
        access: p.access_token || '',
        refresh: p.refresh_token || '',
        expires: p.expires_at ? new Date(p.expires_at).getTime() : 0,
        email: p.email || '',
        accountId: p.account_id || '',
      };
    }
    fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  " "$LEGACY_AUTH" "$AGENT_AUTH"
  log "INFO  Migrated auth-profiles.json to per-agent path (format converted)"
fi

# Seed auth-profiles from /data/config/ (for eval/dev containers that bind-mount credentials)
SEED_AUTH="/data/config/auth-profiles.json"
if [ -f "$SEED_AUTH" ] && [ ! -f "$AGENT_AUTH" ]; then
  cp "$SEED_AUTH" "$AGENT_AUTH"
  chmod 600 "$AGENT_AUTH"
  log "INFO  Seeded auth-profiles.json from /data/config/"
fi

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
    # Feature-gated skills: skip if their feature toggle is off
    [ "$skill_name" = "google-calendar" ] && [ "$GOOGLE_CALENDAR_ENABLED" != "true" ] && continue
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

# GATEWAY_TOKEN was already sourced from .env at the top of the script.

if [ "$SETUP_MODE" = "true" ]; then
  log "INFO  Setup mode — skipping config generation"
else
  # Generate openclaw.json from template + .env. The logic lives in a
  # standalone script so both this boot path and the post-wizard hot-reload
  # path (triggered by setup-server/server.js after a wizard completes)
  # share the exact same code. DRY and always consistent. The regen script
  # re-sources /data/config/.env so it always sees the latest secrets that
  # the wizard may have just written.
  log "INFO  Generating OpenClaw config from template (regen-openclaw-config.sh)"
  export OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH
  sh /app/scripts/regen-openclaw-config.sh
  log "INFO  OpenClaw config written to $OPENCLAW_CONFIG_PATH"

  # Operator-visibility logs. The actual JSON injection lives in the regen
  # script — we only log which optional features ended up enabled so that
  # limbo logs is immediately informative. GROQ_API_KEY / BRAVE_API_KEY /
  # TELEGRAM_BOT_TOKEN are already in the environment thanks to the .env
  # sourcing at the top of this script.
  [ "$TELEGRAM_ENABLED" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ] && \
    log "INFO  Telegram channel enabled in config"
  [ "$VOICE_ENABLED" = "true" ] && [ -n "$GROQ_API_KEY" ] && \
    log "INFO  Voice transcription enabled (audio pinned to groq)"
  [ "$WEB_SEARCH_ENABLED" = "true" ] && [ -n "$BRAVE_API_KEY" ] && \
    log "INFO  Web search enabled in config"
  [ "$GOOGLE_CALENDAR_ENABLED" = "true" ] && \
    log "INFO  Google Calendar enabled"
fi

# ── Run migrations ────────────────────────────────────────────────────────────
log "INFO  Running migration runner"
node /app/migrations/index.js
log "INFO  Migrations OK"

# ── Export state dir for OpenClaw ─────────────────────────────────────────────
export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_PATH

# ── Setup mode: start wizard instead of OpenClaw ─────────────────────────────
# When setup completes, the server exits and Docker restarts the container.
# On restart, /data/config/.env exists → normal startup path.
if [ "$SETUP_MODE" = "true" ]; then
  # Limbo Cloud instances expose port 80 to the internet via Cloudflare.
  # Use SETUP_LISTEN_PORT to override the wizard's listen port without touching
  # LIMBO_PORT — the wizard persists LIMBO_PORT to .env on completion, and we
  # don't want it to save "80" (which would collide with the public server).
  if [ -n "${LIMBO_PUBLIC_URL:-}" ]; then
    export SETUP_LISTEN_PORT=80
  fi
  log "INFO  No configuration found — starting setup wizard on port ${SETUP_LISTEN_PORT:-$LIMBO_PORT}"
  exec gosu limbo node /app/setup-server/server.js
fi

# ── Clean up force-setup markers ─────────────────────────────────────────────
# If we reach here, config exists and the supervisor is about to start. Remove
# the markers so that the NEXT --reconfigure / --switch-brain run works. The
# connect-calendar marker is gone: that flow lives in the control plane now
# and does not touch entrypoint state.
rm -f "$FORCE_DONE_MARKER" "$SWITCH_BRAIN_MARKER"

# ── Wakeup routine ──────────────────────────────────────────────────────────
# Deterministic system-level checks that run BEFORE the agent starts.
# Uses Telegram Bot API directly — no dependency on OpenClaw.
# Non-fatal: if it fails, OpenClaw still starts.
if [ "$TELEGRAM_ENABLED" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  log "INFO  Running wakeup routine"
  node /app/lib/wakeup.js 2>&1 | while IFS= read -r line; do log "WAKE  $line"; done || true
else
  log "INFO  Telegram not enabled — skipping wakeup routine"
fi

# ── Start wizard supervisor (manages OpenClaw + on-demand wizards) ──────────
# The supervisor replaces `exec openclaw gateway`. It launches OpenClaw as a
# child process and exposes a TCP control plane (127.0.0.1:LIMBO_PORT+2 inside
# the container, published via docker-compose port mapping) that the host CLI
# uses to request wizard sessions (connect-calendar, switch-brain, etc.)
# without forcing a container rebuild or recreate.
LIMBO_CONTROL_PORT="${LIMBO_CONTROL_PORT:-$((LIMBO_PORT + 2))}"
export LIMBO_CONTROL_PORT
log "INFO  Starting wizard supervisor (control plane: 127.0.0.1:${LIMBO_CONTROL_PORT})"
# Final ownership fix — entrypoint creates dirs/files as root; ensure everything
# is limbo-owned before dropping privileges via gosu.
chown -R limbo:limbo /data /home/limbo/.openclaw 2>/dev/null || true
exec gosu limbo node /app/scripts/supervisor.js
