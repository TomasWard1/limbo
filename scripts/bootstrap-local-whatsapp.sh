#!/usr/bin/env bash
# Bootstrap the local end-to-end stack for WhatsApp + Kapso + LiteLLM.
#
# Single source of truth: .env.local (gitignored, in the repo root).
# You fill three values there (Anthropic key, Kapso key, Kapso phone-id);
# this script generates + materializes everything else.
#
# What it does (idempotent — safe to re-run):
#   1. Loads .env.local.
#   2. Generates + persists LITELLM_MASTER_KEY and GATEWAY_TOKEN if missing.
#   3. Writes /tmp/limbo-local-whatsapp/litellm-config.yaml
#      and config/litellm.env from template.
#   4. Starts the LiteLLM container, waits for health.
#   5. Mints a virtual API key via /key/generate (persisted across runs).
#   6. Writes /tmp/limbo-local-whatsapp/config/.env for the Limbo container.
#
# What you do after this script:
#   - ngrok http 80   (keep running in another terminal)
#   - LIMBO_PUBLIC_URL=<ngrok-https-url> docker compose -f docker-compose.local-whatsapp.yml up -d limbo
#   - Configure Kapso webhook → <LIMBO_PUBLIC_URL>/channel/whatsapp
#   - Message the Kapso number from your phone

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"

info() { printf '\033[0;36m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[0;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. prereqs ────────────────────────────────────────────────────────
command -v docker   >/dev/null || fail "docker CLI required"
command -v jq       >/dev/null || fail "jq required"
command -v openssl  >/dev/null || fail "openssl required"
command -v curl     >/dev/null || fail "curl required"

[ -f "$ENV_FILE" ] || fail ".env.local not found at $ENV_FILE — copy .env.local.example and fill it in"

# ── 2. load .env.local ────────────────────────────────────────────────
# Allow KEY=VALUE lines only; ignore comments + blanks. set -a exports
# everything sourced so subsequent steps see the vars.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env.local}"
: "${KAPSO_API_KEY:?set KAPSO_API_KEY in .env.local}"
: "${KAPSO_PHONE_NUMBER_ID:?set KAPSO_PHONE_NUMBER_ID in .env.local}"

STATE_DIR="${STATE_DIR:-/tmp/limbo-local-whatsapp}"
CONFIG_DIR="$STATE_DIR/config"
LIMBO_IMAGE="${LIMBO_IMAGE:-limbo:local-whatsapp}"
USER_TIMEZONE="${USER_TIMEZONE:-America/Argentina/Buenos_Aires}"

# Sanity check Anthropic key shape — OAuth tokens (sk-ant-oat-*) won't
# authenticate against api.anthropic.com from LiteLLM; flag early.
# Current Anthropic API key format is sk-ant-api<version>- e.g. sk-ant-api03-.
case "$ANTHROPIC_API_KEY" in
  sk-ant-api*-*) ;;
  sk-ant-oat-*) fail "ANTHROPIC_API_KEY looks like an OAuth token (sk-ant-oat-*). LiteLLM needs a real API key (sk-ant-api...). Provision one at console.anthropic.com and paste it into .env.local." ;;
  sk-ant-*)     warn "ANTHROPIC_API_KEY prefix is non-standard; proceeding anyway" ;;
  *)            fail "ANTHROPIC_API_KEY doesn't look like an Anthropic key (expected sk-ant-api<version>-...)" ;;
esac

# ── 3. scaffolding ────────────────────────────────────────────────────
mkdir -p "$STATE_DIR" "$CONFIG_DIR" "$STATE_DIR/vault" "$STATE_DIR/openclaw-state" "$STATE_DIR/flags"

# Persistent generated secrets. Regenerating them invalidates the virtual
# key, so we only generate once per state dir.
MASTER_KEY_FILE="$CONFIG_DIR/.litellm_master_key"
if [ ! -f "$MASTER_KEY_FILE" ]; then
  openssl rand -hex 32 > "$MASTER_KEY_FILE"
  chmod 600 "$MASTER_KEY_FILE"
  info "generated LITELLM_MASTER_KEY"
fi
LITELLM_MASTER_KEY="$(tr -d '\n' < "$MASTER_KEY_FILE")"

GATEWAY_TOKEN_FILE="$CONFIG_DIR/.gateway_token"
if [ ! -f "$GATEWAY_TOKEN_FILE" ]; then
  openssl rand -hex 16 > "$GATEWAY_TOKEN_FILE"
  chmod 600 "$GATEWAY_TOKEN_FILE"
  info "generated GATEWAY_TOKEN"
fi
GATEWAY_TOKEN="$(tr -d '\n' < "$GATEWAY_TOKEN_FILE")"

POSTGRES_PASSWORD_FILE="$CONFIG_DIR/.postgres_password"
if [ ! -f "$POSTGRES_PASSWORD_FILE" ]; then
  openssl rand -hex 24 > "$POSTGRES_PASSWORD_FILE"
  chmod 600 "$POSTGRES_PASSWORD_FILE"
  info "generated POSTGRES_PASSWORD"
fi
POSTGRES_PASSWORD="$(tr -d '\n' < "$POSTGRES_PASSWORD_FILE")"

LITELLM_UI_PASSWORD_FILE="$CONFIG_DIR/.litellm_ui_password"
if [ ! -f "$LITELLM_UI_PASSWORD_FILE" ]; then
  openssl rand -hex 16 > "$LITELLM_UI_PASSWORD_FILE"
  chmod 600 "$LITELLM_UI_PASSWORD_FILE"
  info "generated LITELLM_UI_PASSWORD (login at http://127.0.0.1:4000/ui as admin)"
fi
LITELLM_UI_PASSWORD="$(tr -d '\n' < "$LITELLM_UI_PASSWORD_FILE")"

# ── 4. litellm + postgres files ───────────────────────────────────────
cp "$REPO_ROOT/litellm-config.yaml.template" "$STATE_DIR/litellm-config.yaml"

# Postgres env (read by the postgres service itself).
cat > "$CONFIG_DIR/postgres.env" <<EOF
POSTGRES_USER=litellm
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=litellm
EOF
chmod 600 "$CONFIG_DIR/postgres.env"

# LiteLLM env (read by the litellm service).
# NVIDIA_API_KEY is optional — empty is fine, the GLM fallback row will
# simply error out if invoked. We emit it unconditionally so LiteLLM
# doesn't bail at config load with a missing-env-var complaint.
cat > "$CONFIG_DIR/litellm.env" <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
NVIDIA_API_KEY=${NVIDIA_API_KEY:-}
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
DATABASE_URL=postgresql://litellm:$POSTGRES_PASSWORD@postgres:5432/litellm
STORE_MODEL_IN_DB=True
UI_USERNAME=admin
UI_PASSWORD=$LITELLM_UI_PASSWORD
EOF
chmod 600 "$CONFIG_DIR/litellm.env"

if [ -z "${NVIDIA_API_KEY:-}" ]; then
  warn "NVIDIA_API_KEY unset — GLM-5.1 fallback row will 401 if invoked (Sonnet path still works)"
fi

# ── 5. ensure image + bring up litellm ────────────────────────────────
cd "$REPO_ROOT"

if ! docker image inspect "$LIMBO_IMAGE" >/dev/null 2>&1; then
  info "image $LIMBO_IMAGE not found — building from worktree..."
  docker build -t "$LIMBO_IMAGE" .
fi

info "starting postgres + litellm containers..."
docker compose -f docker-compose.local-whatsapp.yml up -d postgres litellm

info "waiting for litellm to be ready (postgres migration must complete)..."
deadline=$(( $(date +%s) + 180 ))
while :; do
  cid="$(docker compose -f docker-compose.local-whatsapp.yml ps -q litellm 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo 'starting')"
    [ "$status" = "healthy" ] && break
  fi
  if [ "$(date +%s)" -gt "$deadline" ]; then
    docker compose -f docker-compose.local-whatsapp.yml logs litellm | tail -50 >&2
    fail "litellm did not become healthy in 60s"
  fi
  sleep 2
done
info "litellm healthy"

# ── 6. virtual key via /key/generate ─────────────────────────────────
# Postgres-backed LiteLLM supports virtual keys. We mint one for Limbo with
# a $50 budget; usage shows up in the LiteLLM admin endpoints per key.
VIRTUAL_KEY_FILE="$CONFIG_DIR/.litellm_virtual_key"
if [ ! -f "$VIRTUAL_KEY_FILE" ]; then
  info "minting virtual key via /key/generate..."
  resp="$(curl -fsS -X POST http://127.0.0.1:4000/key/generate \
    -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"models":["claude-sonnet-4-6"],"max_budget":50.0,"key_alias":"limbo-local-whatsapp"}')"
  virtual="$(echo "$resp" | jq -r '.key')"
  [ -n "$virtual" ] && [ "$virtual" != "null" ] || fail "LiteLLM /key/generate failed: $resp"
  printf '%s' "$virtual" > "$VIRTUAL_KEY_FILE"
  chmod 600 "$VIRTUAL_KEY_FILE"
  info "virtual key saved (\$50 budget, alias limbo-local-whatsapp)"
fi
VIRTUAL_KEY="$(tr -d '\n' < "$VIRTUAL_KEY_FILE")"

# ── 7. limbo .env ─────────────────────────────────────────────────────
cat > "$CONFIG_DIR/.env" <<EOF
# Generated by scripts/bootstrap-local-whatsapp.sh from $ENV_FILE.
# Safe to regenerate; do NOT commit.

# ── Core ───────────────────────────────────────────────────────────
CLI_LANGUAGE=en
LIMBO_PORT=18900
USER_TIMEZONE=$USER_TIMEZONE
AUTH_MODE=api-key
GATEWAY_TOKEN=$GATEWAY_TOKEN

# ── LLM via LiteLLM side-car ───────────────────────────────────────
# OpenClaw talks native Anthropic protocol; LiteLLM transparently proxies
# /v1/messages to the real Anthropic backend. The real provider key is
# container-local to litellm and never touches this file.
MODEL_PROVIDER=anthropic
MODEL_NAME=claude-sonnet-4-6
LLM_API_KEY=$VIRTUAL_KEY
LITELLM_ENABLED=true
LITELLM_URL=http://litellm:4000

# ── WhatsApp (Kapso) channel ───────────────────────────────────────
CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true
KAPSO_API_KEY=$KAPSO_API_KEY
KAPSO_PHONE_NUMBER_ID=$KAPSO_PHONE_NUMBER_ID

# ── Legacy features (deprecated; disabled in local MVP) ────────────
TELEGRAM_ENABLED=false
VOICE_ENABLED=false
WEB_SEARCH_ENABLED=false
GOOGLE_CALENDAR_ENABLED=false
EOF
chmod 600 "$CONFIG_DIR/.env"

info ""
info "bootstrap complete."
info ""
info "next steps:"
info "  1) ngrok http 80     (keep this running in another terminal)"
info "  2) export LIMBO_PUBLIC_URL=<ngrok-https-url>"
info "  3) docker compose -f docker-compose.local-whatsapp.yml up -d limbo"
info "  4) Kapso dashboard → set the inbound_message webhook to"
info "       <LIMBO_PUBLIC_URL>/channel/whatsapp"
info "  5) send a WhatsApp message from your phone to the Kapso number"
info ""
info "state dir:   $STATE_DIR"
info "tail logs:   docker compose -f docker-compose.local-whatsapp.yml logs -f"
info ""
info "LiteLLM admin UI: http://127.0.0.1:4000/ui"
info "  username: admin"
info "  password: \$(cat $LITELLM_UI_PASSWORD_FILE)"
