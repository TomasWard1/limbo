# syntax=docker/dockerfile:1

# OpenClaw version — pin to avoid surprise upgrades in production
ARG OPENCLAW_VERSION=latest

# ──────────────────────────────────────────────
# Stage 1: deps — build MCP server native addons
# better-sqlite3 requires python3/make/g++ for node-gyp compilation.
# This stage is discarded after extracting node_modules.
# ──────────────────────────────────────────────
FROM node:22-slim AS deps

# Build tools for native addons (better-sqlite3 requires compilation)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy MCP server manifest and lockfile (layer cached unless these change)
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/

# Install deps without running lifecycle scripts, then rebuild better-sqlite3
# native addon explicitly. Verify with an in-memory open/close smoke test.
RUN cd mcp-server \
  && npm ci --omit=dev --ignore-scripts \
  && cd node_modules/better-sqlite3 \
  && npx node-gyp rebuild --release \
  && cd /build \
  && node -e "const d=require('/build/mcp-server/node_modules/better-sqlite3');const db=d(':memory:');db.close();console.log('better-sqlite3 OK')"

# ──────────────────────────────────────────────
# Stage 2: runtime — OpenClaw + MCP server + workspace
# Migrated from ZeroClaw (Rust binary) to OpenClaw (Node.js npm package).
# OpenClaw is installed globally via npm — no custom binary build needed.
# ──────────────────────────────────────────────
FROM node:22-slim AS runtime

ARG OPENCLAW_VERSION

# Runtime system deps:
#   gettext-base — envsubst for config template rendering
#   tzdata       — timezone support
#   tini         — minimal init for proper signal handling (PID 1 reaping)
#   libssl3      — OpenSSL 3 shared lib needed by OpenClaw's ACP runtime (codex-acp)
#   python3      — required by OpenClaw's pinned-write-helper for safe atomic file writes
#   git          — required by @googleworkspace/cli (gws) npm package at install time
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base tzdata tini libssl3 python3 ca-certificates gosu git && rm -rf /var/lib/apt/lists/* \
  && groupadd -r limbo && useradd --create-home -r -g limbo limbo

# Install OpenClaw globally — replaces the ZeroClaw Rust binary.
# Pinned via OPENCLAW_VERSION build arg (default: latest).
# @googleworkspace/cli (gws) — Google Calendar integration (optional feature).
# Pin 0.22.3 because 0.22.4+ requires GLIBC_2.39 on linux/amd64, but node:22-slim
# currently ships Debian 12 / glibc 2.36 in production.
# grammy — peer dependency of OpenClaw's telegram channel extension. OpenClaw
# loads the extension module eagerly on gateway start regardless of whether
# the channel is enabled, so without grammy on the module path the gateway
# crashes with "Cannot find module 'grammy'" even when TELEGRAM_ENABLED=false.
# Pinned to the version that ships with OpenClaw's lockfile to avoid accidental
# API drift. Bump when OpenClaw's own grammy peer range shifts.
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" "@googleworkspace/cli@0.22.3" "grammy@^1.31.0" "openclaw-whatsapp-kapso@^2026.4.30"

# Apply local patch for openclaw#63851 — the guarded fetch drops FormData fields,
# breaking Groq audio transcription. Remove this once upstream PR #64349 ships in
# a released openclaw version; the patcher is idempotent and fails loudly if
# the openclaw code shape has changed.
COPY scripts/patch-openclaw-audio.mjs /tmp/patch-openclaw-audio.mjs
RUN node /tmp/patch-openclaw-audio.mjs && rm /tmp/patch-openclaw-audio.mjs

# App directories
WORKDIR /app

# MCP server: source code first, then node_modules from deps stage (overrides host binaries)
COPY --chown=limbo:limbo mcp-server/ ./mcp-server/
COPY --from=deps /build/mcp-server/node_modules ./mcp-server/node_modules

# Setup wizard server (zero dependencies — plain Node.js HTTP server)
COPY --chown=limbo:limbo setup-server/ /app/setup-server/

# System workspace files (product-owned, root-owned for read-only enforcement via symlinks)
COPY workspace/system/ ./workspace/system/

# Skills (product-owned, synced to OpenClaw workspace on boot by entrypoint)
COPY workspace/skills/ ./workspace/skills/

# User workspace templates (limbo-owned, seeded on first run)
COPY --chown=limbo:limbo workspace/templates/ ./workspace/templates/

# Migration runner (no external deps — pure Node.js stdlib)
COPY --chown=limbo:limbo migrations/ ./migrations/

# Shared libs (telegram-notify, wakeup routine)
COPY --chown=limbo:limbo lib/ ./lib/

# Package metadata (version read by wakeup routine)
COPY --chown=limbo:limbo package.json ./package.json

# User-facing release notes (parsed by wakeup routine for update messages)
COPY --chown=limbo:limbo RELEASES.md ./RELEASES.md

# OpenClaw config template (populated by entrypoint from env vars)
COPY --chown=limbo:limbo openclaw.json.template ./openclaw.json.template

# Entrypoint script
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Wizard supervisor (container main process after entrypoint bootstrap) +
# standalone regen helper used by both the entrypoint and the setup-server
# to rewrite openclaw.json on boot and after wizard completion.
COPY --chown=limbo:limbo scripts/supervisor.js /app/scripts/supervisor.js
COPY --chown=limbo:limbo scripts/regen-openclaw-config.sh /app/scripts/regen-openclaw-config.sh
RUN chmod +x /app/scripts/regen-openclaw-config.sh /app/scripts/supervisor.js

# Pre-create dirs with correct ownership for image-layer defaults
RUN mkdir -p /data && chown limbo:limbo /data
RUN mkdir -p /flags && chown limbo:limbo /flags
RUN mkdir -p /home/limbo/.openclaw && chown limbo:limbo /home/limbo/.openclaw
# Fix npm cache ownership — npm install -g runs as root but limbo user needs write access at runtime
RUN mkdir -p /home/limbo/.npm && chown -R limbo:limbo /home/limbo/.npm
RUN chown limbo:limbo /app

# Data volume — vault, db, config, memory, backups, logs
VOLUME ["/data"]

# OpenClaw gateway port
EXPOSE 18789

# Container starts as root — entrypoint.sh chowns data dirs then drops to
# non-root limbo user via gosu. This is the standard pattern used by
# PostgreSQL, Redis, and other Docker official images to handle bind-mount
# ownership mismatches between host and container users.

# tini as init process for proper signal forwarding and zombie reaping
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
