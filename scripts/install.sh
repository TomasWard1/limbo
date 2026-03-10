#!/usr/bin/env bash
# install.sh — Limbo one-line installer
# Usage: curl -fsSL https://get.limbo.ar | bash
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()    { echo -e "${CYAN}[limbo]${NC} $*"; }
ok()     { echo -e "${GREEN}[limbo]${NC} $*"; }
warn()   { echo -e "${YELLOW}[limbo]${NC} $*"; }
die()    { echo -e "${RED}[limbo] ERROR:${NC} $*" >&2; exit 1; }
header() { echo -e "\n${BOLD}$*${NC}"; }

# ─── Pre-flight checks ────────────────────────────────────────────────────────
header "=== Limbo Installer ==="

# Root check
if [[ $EUID -ne 0 ]]; then
  die "This script must be run as root. Try: sudo bash <(curl -fsSL https://get.limbo.ar)"
fi

# OS detection — Ubuntu / Debian only
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION_ID="${VERSION_ID:-}"
else
  die "Cannot detect OS. Only Ubuntu and Debian are supported."
fi

case "$OS_ID" in
  ubuntu|debian) ;;
  *) die "Unsupported OS: $OS_ID. Only Ubuntu and Debian are supported." ;;
esac

log "Detected OS: $OS_ID $OS_VERSION_ID"

# Disk space (10 GB minimum)
AVAILABLE_KB=$(df -k / | awk 'NR==2 {print $4}')
REQUIRED_KB=$((10 * 1024 * 1024))
if [[ $AVAILABLE_KB -lt $REQUIRED_KB ]]; then
  AVAILABLE_GB=$(( AVAILABLE_KB / 1024 / 1024 ))
  die "Insufficient disk space. Need 10 GB, have ~${AVAILABLE_GB} GB free."
fi

# RAM (2 GB minimum)
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
REQUIRED_MEM_KB=$((2 * 1024 * 1024))
if [[ $TOTAL_MEM_KB -lt $REQUIRED_MEM_KB ]]; then
  TOTAL_MEM_GB=$(echo "scale=1; $TOTAL_MEM_KB / 1024 / 1024" | bc)
  die "Insufficient memory. Need 2 GB, have ${TOTAL_MEM_GB} GB."
fi

ok "Pre-flight checks passed."

# ─── Install Docker ───────────────────────────────────────────────────────────
header "Checking Docker..."

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  ok "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  ok "Docker installed: $(docker --version)"
fi

# ─── Create /opt/limbo ───────────────────────────────────────────────────────
header "Setting up /opt/limbo..."
mkdir -p /opt/limbo
log "Directory /opt/limbo ready."

# ─── Collect API keys ─────────────────────────────────────────────────────────
header "Configuration"
echo "You'll need an Anthropic API key (get one at https://console.anthropic.com)."
echo "Telegram integration is optional — skip by pressing Enter."
echo ""

prompt_required() {
  local varname="$1"
  local label="$2"
  local value=""
  while [[ -z "$value" ]]; do
    read -rp "  ${label}: " value
    if [[ -z "$value" ]]; then
      warn "This field is required."
    fi
  done
  printf -v "$varname" '%s' "$value"
}

prompt_optional() {
  local varname="$1"
  local label="$2"
  local default="${3:-}"
  read -rp "  ${label} [${default}]: " value
  printf -v "$varname" '%s' "${value:-$default}"
}

prompt_required ANTHROPIC_API_KEY "Anthropic API key (sk-ant-...)"

prompt_optional TELEGRAM_ENABLED "Enable Telegram bot? (true/false)" "false"
TELEGRAM_BOT_TOKEN=""
if [[ "$TELEGRAM_ENABLED" == "true" ]]; then
  prompt_required TELEGRAM_BOT_TOKEN "Telegram bot token"
fi

prompt_optional MODEL_PROVIDER "Model provider" "anthropic"
prompt_optional MODEL_NAME     "Model name"     "claude-sonnet-4-6"

# ─── Write .env ───────────────────────────────────────────────────────────────
header "Writing /opt/limbo/.env..."
cat > /opt/limbo/.env <<EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
MODEL_PROVIDER=${MODEL_PROVIDER}
MODEL_NAME=${MODEL_NAME}
TELEGRAM_ENABLED=${TELEGRAM_ENABLED}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
EOF
chmod 600 /opt/limbo/.env
ok ".env written."

# ─── Download docker-compose.yml ──────────────────────────────────────────────
header "Downloading docker-compose.yml..."
COMPOSE_URL="https://raw.githubusercontent.com/tomasward1/limbo/main/docker-compose.yml"
curl -fsSL "$COMPOSE_URL" -o /opt/limbo/docker-compose.yml
ok "docker-compose.yml downloaded."

# ─── Start Limbo ─────────────────────────────────────────────────────────────
header "Starting Limbo..."
cd /opt/limbo
docker compose pull -q
docker compose up -d
ok "Container started."

# ─── Install update cron ──────────────────────────────────────────────────────
header "Installing update cron job..."
CRON_CMD="cd /opt/limbo && docker compose pull -q && docker compose up -d --remove-orphans >> /var/log/limbo-update.log 2>&1"
CRON_ENTRY="0 4 * * * $CRON_CMD"

# Add only if not already present
if crontab -l 2>/dev/null | grep -qF "limbo"; then
  warn "Cron job already exists — skipping."
else
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
  ok "Cron job installed (daily at 04:00)."
fi

# ─── Health check ─────────────────────────────────────────────────────────────
header "Verifying health..."
HEALTH_ATTEMPTS=12
HEALTH_OK=false
for i in $(seq 1 $HEALTH_ATTEMPTS); do
  HEALTH=$(docker compose -f /opt/limbo/docker-compose.yml ps --format json 2>/dev/null \
    | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
  if [[ "$HEALTH" == "healthy" ]]; then
    HEALTH_OK=true
    break
  fi
  log "Waiting for container to be healthy... ($i/$HEALTH_ATTEMPTS)"
  sleep 5
done

if [[ "$HEALTH_OK" == "false" ]]; then
  warn "Container did not report healthy within timeout."
  warn "Check logs with: docker compose -f /opt/limbo/docker-compose.yml logs"
else
  ok "Container is healthy."
fi

# ─── Success message ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         Limbo installed successfully!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}OpenClaw gateway:${NC} ws://127.0.0.1:18789"
echo -e "  ${BOLD}Data directory:${NC}   /opt/limbo/"
echo -e "  ${BOLD}Logs:${NC}             docker compose -f /opt/limbo/docker-compose.yml logs -f"
echo -e "  ${BOLD}Update:${NC}           Automatic (daily at 04:00) or run:"
echo -e "                    cd /opt/limbo && docker compose pull && docker compose up -d"
echo ""
