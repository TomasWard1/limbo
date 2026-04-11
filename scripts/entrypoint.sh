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

# ── Load config from .env ────────────────────────────────────────────────────
# After the secrets-consolidation refactor, all tokens live inside
# /data/config/.env — there are no separate secret files or Docker
# secrets to read. Source it now so the rest of the script sees
# LLM_API_KEY / TELEGRAM_BOT_TOKEN / GROQ_API_KEY / BRAVE_API_KEY /
# GATEWAY_TOKEN as regular environment variables.
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/limbo/.openclaw}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"

if [ -f /data/config/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /data/config/.env
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

# -- Handle connect-calendar mode --------------------------------------------
# CLI sets CONNECT_CALENDAR_MODE=true to run a reduced wizard that only
# handles Google Calendar OAuth. Unlike SWITCH_BRAIN_MODE, this preserves
# ALL existing config — it just needs to force the wizard server to run.
CONNECT_CALENDAR_MARKER="/data/.connect-calendar-done"
CONNECT_CALENDAR_ACTIVE=false
if [ "${CONNECT_CALENDAR_MODE:-}" = "true" ] && [ ! -f "$CONNECT_CALENDAR_MARKER" ]; then
  log "INFO  CONNECT_CALENDAR_MODE requested — forcing wizard for Google Calendar OAuth"
  CONNECT_CALENDAR_ACTIVE=true
  touch "$CONNECT_CALENDAR_MARKER"
fi

# ── Detect setup mode (no config yet → wizard will handle everything) ────────
# The .env was already sourced at the top of the script. Two states are
# treated as "setup mode": (a) no .env at all, and (b) .env present but
# without MODEL_PROVIDER (half-configured — preserve features, ask brain).
SETUP_MODE=false
if [ ! -f /data/config/.env ]; then
  SETUP_MODE=true
elif [ -z "${MODEL_PROVIDER:-}" ]; then
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

# ── Bootstrap data dirs ───────────────────────────────────────────────────────
OC_CRON="$OPENCLAW_STATE_DIR/cron"
mkdir -p /data/vault/notes /data/vault/maps /data/vault/assets /data/config "$OPENCLAW_STATE_DIR" "$OC_CRON"

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
  # We pin the audio provider to Groq explicitly in tools.media.audio.models
  # instead of relying on OpenClaw's auto-resolver. The auto-resolver picks the
  # first provider whose auth is satisfied, without fallover on HTTP errors.
  # When a model provider like openai-codex has an OAuth profile, it gets
  # matched as "openai has auth" for audio too, and the resolver picks OpenAI
  # Whisper — which costs API credits separate from the Codex subscription and
  # returns HTTP 429 once the OpenAI quota is exhausted. Pinning to Groq
  # guarantees voice notes go to the free/fast Groq Whisper endpoint.
  # GROQ_API_KEY was already sourced from .env at the top of the script.
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
    " "$OPENCLAW_CONFIG_PATH"
    log "INFO  Voice transcription enabled (GROQ_API_KEY exported, audio pinned to groq)"
  fi

  # Web search (Brave)
  # OpenClaw schema: tools.web.search with provider and env-based API key.
  # BRAVE_API_KEY was already sourced from .env at the top of the script.
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

  # Google Calendar (gws CLI)
  # When enabled, export env vars that gws reads for auth, and inject
  # GOOGLE_CALENDAR_ENABLED into the MCP server env so tools can check it.
  # gws writes a discovery cache to its config dir — point to /tmp so it works
  # on read-only root filesystems (docker-compose.test.yml has read_only: true).
  # Check the new consolidated location first, fall back to legacy path for
  # instances that went through the old secrets/ layout.
  GCAL_CREDS="$OPENCLAW_STATE_DIR/google/credentials.json"
  if [ ! -f "$GCAL_CREDS" ] && [ -f "$OPENCLAW_STATE_DIR/secrets/google_calendar_credentials.json" ]; then
    GCAL_CREDS="$OPENCLAW_STATE_DIR/secrets/google_calendar_credentials.json"
  fi
  if [ "$GOOGLE_CALENDAR_ENABLED" = "true" ] && [ -f "$GCAL_CREDS" ]; then
    export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="$GCAL_CREDS"
    export GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND="file"
    export GOOGLE_WORKSPACE_CLI_CONFIG_DIR="/tmp/gws"
    mkdir -p /tmp/gws
    export GOOGLE_CALENDAR_ENABLED

    # Inject GOOGLE_CALENDAR_ENABLED and GWS env vars into the limbo-vault MCP server
    # so the calendar tools (which live in the same MCP server) can call gws.
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const srv = cfg.mcp.servers['limbo-vault'];
      if (srv && srv.env) {
        srv.env.GOOGLE_CALENDAR_ENABLED = 'true';
        srv.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
        srv.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = 'file';
        srv.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = '/tmp/gws';
      }
      fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
    " "$OPENCLAW_CONFIG_PATH"
    log "INFO  Google Calendar enabled (credentials at $GCAL_CREDS)"
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

# ── Connect-calendar mode: start reduced wizard for Google Calendar OAuth ───
# Preserves all existing config, just needs the wizard server to run once.
if [ "$CONNECT_CALENDAR_ACTIVE" = "true" ]; then
  log "INFO  CONNECT_CALENDAR_MODE — starting Google Calendar wizard on port $LIMBO_PORT"
  export CONNECT_CALENDAR_MODE
  exec node /app/setup-server/server.js
fi

# ── Clean up force-setup markers ─────────────────────────────────────────────
# If we reach here, config exists and OpenClaw is about to start normally.
# Remove the markers so that the NEXT --reconfigure/--switch-brain/--connect-calendar will work.
rm -f "$FORCE_DONE_MARKER" "$SWITCH_BRAIN_MARKER" "$CONNECT_CALENDAR_MARKER"

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

# ── Start OpenClaw gateway ───────────────────────────────────────────────────
log "INFO  Starting OpenClaw gateway"
if [ "${LIMBO_VERBOSE:-}" = "true" ]; then
  log "INFO  LIMBO_VERBOSE=true — enabling OpenClaw verbose logging"
  exec openclaw gateway --verbose
else
  exec openclaw gateway
fi
