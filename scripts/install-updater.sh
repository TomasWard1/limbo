#!/usr/bin/env bash
# install-updater.sh — Install the Limbo auto-update watcher on the host.
#
# Creates two systemd units:
#   - limbo-updater.path:    watches for /flags/update.flag in the Limbo container
#   - limbo-updater.service: runs `limbo update` when the flag appears
#
# Called automatically by `limbo start` on first run, or manually:
#   sudo bash scripts/install-updater.sh
#
# The flag directory (~/.limbo/flags/) is bind-mounted into the container at /flags.

set -euo pipefail

LIMBO_DIR="${LIMBO_DIR:-$HOME/.limbo}"
FLAGS_DIR="$LIMBO_DIR/flags"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'
log() { echo -e "${CYAN}[limbo-updater]${NC} $*"; }
ok()  { echo -e "${GREEN}[limbo-updater]${NC} $*"; }

# ── Create flags directory ───────────────────────────────────────────────────
mkdir -p "$FLAGS_DIR"

# ── Write systemd path unit ─────────────────────────────────────────────────
cat > /etc/systemd/system/limbo-updater.path <<EOF
[Unit]
Description=Watch for Limbo update requests

[Path]
PathExists=$FLAGS_DIR/update.flag
# Re-arm after the service runs (flag gets deleted, path resets)
MakeDirectory=yes

[Install]
WantedBy=multi-user.target
EOF

# ── Write systemd service unit ──────────────────────────────────────────────
# The service:
#   1. Records the current version in updated.flag (so the new container
#      knows what it was updated FROM and can notify the user)
#   2. Removes the trigger flag
#   3. Runs limbo update (pull + restart)
cat > /etc/systemd/system/limbo-updater.service <<EOF
[Unit]
Description=Limbo self-update executor

[Service]
Type=oneshot

# Save previous version so the new container can report what changed
ExecStartPre=/bin/bash -c 'npm view limbo-ai version 2>/dev/null > $FLAGS_DIR/updated.flag || echo "unknown" > $FLAGS_DIR/updated.flag'
# Remove the trigger flag so the path unit can re-arm
ExecStartPre=/bin/rm -f $FLAGS_DIR/update.flag

ExecStart=$(command -v limbo || echo /usr/local/bin/limbo) update

# If update fails, clean up the updated.flag so wakeup doesn't fire
ExecStopPost=/bin/bash -c 'if [ \$EXIT_STATUS -ne 0 ]; then rm -f $FLAGS_DIR/updated.flag; fi'
EOF

# ── Enable and start ────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now limbo-updater.path

ok "Updater watcher installed and active"
log "Watching: $FLAGS_DIR/update.flag"
log "Action:   limbo update"
