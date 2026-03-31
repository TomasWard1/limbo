#!/usr/bin/env bash
# install.sh — Limbo one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/TomasWard1/limbo/main/scripts/install.sh | bash
#
# Installs Docker, Node.js, and the Limbo CLI. Pre-pulls the Docker image.
# After running, SSH in and run `limbo start` to enter the setup wizard.
#
# NOTE: Requires bash, not sh.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: This script requires bash. Run with: curl -fsSL ... | bash" >&2
  exit 1
fi
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()    { echo -e "${CYAN}[limbo]${NC} $*"; }
ok()     { echo -e "${GREEN}[limbo]${NC} $*"; }
warn()   { echo -e "${YELLOW}[limbo]${NC} $*"; }
die()    { echo -e "${RED}[limbo] ERROR:${NC} $*" >&2; exit 1; }
header() { echo -e "\n${BOLD}$*${NC}"; }

# ─── Pre-flight checks ──────────────────────────────────────────────────────
header "=== Limbo Installer ==="

if [[ $EUID -ne 0 ]]; then
  die "Run as root. Try: sudo bash <(curl -fsSL https://raw.githubusercontent.com/TomasWard1/limbo/main/scripts/install.sh)"
fi

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

log "Detected: $OS_ID $OS_VERSION_ID"

# Disk space (10 GB minimum)
AVAILABLE_KB=$(df -k / | awk 'NR==2 {print $4}')
if [[ $AVAILABLE_KB -lt $((10 * 1024 * 1024)) ]]; then
  die "Need 10 GB free disk space, have ~$(( AVAILABLE_KB / 1024 / 1024 )) GB."
fi

# RAM (512 MB minimum, 1 GB recommended)
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
if [[ $TOTAL_MEM_KB -lt $((512 * 1024)) ]]; then
  die "Need 512 MB RAM, have $(( TOTAL_MEM_KB / 1024 )) MB."
fi
if [[ $TOTAL_MEM_KB -lt $((1024 * 1024)) ]]; then
  warn "Low memory ($(( TOTAL_MEM_KB / 1024 )) MB). Recommended: 1 GB+."
fi

ok "Pre-flight checks passed."

# ─── Install Docker ──────────────────────────────────────────────────────────
header "Docker"

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  ok "Already installed: $(docker --version | head -1)"
else
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Installed: $(docker --version | head -1)"
fi

# ─── Install Node.js ─────────────────────────────────────────────────────────
header "Node.js"

if command -v node &>/dev/null && node -v | grep -qE '^v(1[89]|2[0-9])'; then
  ok "Already installed: $(node -v)"
else
  log "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  ok "Installed: $(node -v)"
fi

# ─── Install Limbo CLI ───────────────────────────────────────────────────────
header "Limbo CLI"

npm install -g limbo-ai@latest --loglevel=error 2>&1
ok "Installed: limbo v$(limbo -v 2>/dev/null || echo 'unknown')"

# ─── Install cloudflared (for setup tunnels) ────────────────────────────────
header "Cloudflared"

if command -v cloudflared &>/dev/null; then
  ok "Already installed: $(cloudflared --version 2>&1 | head -1)"
else
  log "Installing cloudflared..."
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
    | tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq cloudflared
  ok "Installed: $(cloudflared --version 2>&1 | head -1)"
fi


# ─── Pre-pull Docker image ───────────────────────────────────────────────────
header "Docker image"

log "Pulling ghcr.io/tomasward1/limbo:latest..."
if docker pull ghcr.io/tomasward1/limbo:latest; then
  ok "Image ready."
else
  warn "Could not pull image. It will be pulled on first 'limbo start'."
fi

# ─── Done ────────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_IP")
[[ -z "$SERVER_IP" ]] && SERVER_IP="YOUR_IP"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         Limbo installed successfully!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  ${DIM}1.${NC} SSH into this server:"
echo -e "     ${CYAN}ssh root@${SERVER_IP}${NC}"
echo ""
echo -e "  ${DIM}2.${NC} Start Limbo and complete the setup wizard:"
echo -e "     ${CYAN}limbo start${NC}"
echo ""
echo -e "  ${DIM}3.${NC} To update later:"
echo -e "     ${CYAN}limbo update${NC}"
echo ""
