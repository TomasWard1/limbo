# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────
# Stage 1: deps — install MCP server dependencies
# ──────────────────────────────────────────────
FROM node:22-slim AS deps

# Build tools for native addons (better-sqlite3 requires compilation)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy MCP server and install its deps
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
RUN cd mcp-server \
  && npm ci --omit=dev --ignore-scripts \
  && cd node_modules/better-sqlite3 \
  && npx node-gyp rebuild --release \
  && cd /build \
  && node -e "const d=require('/build/mcp-server/node_modules/better-sqlite3');const db=d(':memory:');db.close();console.log('better-sqlite3 OK')"

# ──────────────────────────────────────────────
# Stage 2: ZeroClaw binary
# Custom build with rag-pdf feature enabled.
# Build with: ./scripts/build-zeroclaw.sh
# ──────────────────────────────────────────────
FROM ghcr.io/tomasward1/zeroclaw:v0.5.3-custom AS zeroclaw

# ──────────────────────────────────────────────
# Stage 3: final runtime image
# ──────────────────────────────────────────────
FROM node:22-slim AS runtime

# Non-root user for security + envsubst for template rendering
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base && rm -rf /var/lib/apt/lists/* \
  && groupadd -r limbo && useradd --create-home -r -g limbo limbo

# Copy ZeroClaw binary
COPY --from=zeroclaw /usr/local/bin/zeroclaw /usr/local/bin/zeroclaw

# App directories
WORKDIR /app

# MCP server: source code first, then node_modules from deps stage (overrides host binaries)
COPY --chown=limbo:limbo mcp-server/ ./mcp-server/
COPY --from=deps /build/mcp-server/node_modules ./mcp-server/node_modules

# Setup wizard server (zero dependencies — plain Node.js HTTP server)
COPY --chown=limbo:limbo setup-server/ /app/setup-server/

# System workspace files (product-owned, root-owned for read-only enforcement via symlinks)
COPY workspace/system/ ./workspace/system/

# User workspace templates (limbo-owned, seeded on first run)
COPY --chown=limbo:limbo workspace/templates/ ./workspace/templates/

# Migration runner (no external deps — pure Node.js stdlib)
COPY --chown=limbo:limbo migrations/ ./migrations/

# ZeroClaw config template (populated by entrypoint from env vars)
COPY --chown=limbo:limbo config.toml.template ./config.toml.template

# Entrypoint script
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pre-create dirs with correct ownership for image-layer defaults
RUN mkdir -p /data && chown limbo:limbo /data
RUN mkdir -p /home/limbo/.zeroclaw && chown limbo:limbo /home/limbo/.zeroclaw
RUN chown limbo:limbo /app

# Data volume — vault, db, config, memory, backups, logs
VOLUME ["/data"]

# ZeroClaw gateway port
EXPOSE 18789

# Run as non-root limbo user
USER limbo

ENTRYPOINT ["/entrypoint.sh"]
