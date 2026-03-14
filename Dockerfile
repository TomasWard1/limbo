# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────
# Stage 1: deps — install OpenClaw and MCP server deps
# ──────────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /build

# git is required by node-llama-cpp (openclaw transitive dep) during postinstall.
# Rewrite SSH git URLs to HTTPS so build works without SSH keys.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install OpenClaw and mcporter globally (pinned for reproducibility + CVE control)
RUN npm install -g openclaw@2026.3.12 mcporter@0.7.3

# Copy MCP server and install its deps
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
RUN cd mcp-server && npm ci --omit=dev

# ──────────────────────────────────────────────
# Stage 2: final runtime image
# ──────────────────────────────────────────────
FROM node:22-slim AS runtime

# Non-root user for security + envsubst for template rendering
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base && rm -rf /var/lib/apt/lists/* \
  && groupadd -r limbo && useradd --create-home -r -g limbo limbo

# Copy OpenClaw from deps stage (global npm install)
# Use symlink so that relative imports in openclaw.mjs resolve correctly
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/openclaw/openclaw.mjs /usr/local/bin/openclaw \
  && ln -s /usr/local/lib/node_modules/mcporter/dist/cli.js /usr/local/bin/mcporter

# App directories
WORKDIR /app

# MCP server (code + pruned node_modules)
COPY --from=deps /build/mcp-server/node_modules ./mcp-server/node_modules
COPY --chown=limbo:limbo mcp-server/ ./mcp-server/

# Workspace agent persona files (baked in; USER.md is generated at runtime)
COPY --chown=limbo:limbo workspace/ ./workspace/

# Migration runner (no external deps — pure Node.js stdlib)
COPY --chown=limbo:limbo migrations/ ./migrations/

# openclaw.json template (populated by entrypoint from env vars)
COPY --chown=limbo:limbo openclaw.json.template ./openclaw.json.template

# mcporter config — registers the limbo-vault MCP stdio server
COPY --chown=limbo:limbo mcporter.json ./mcporter.json

# Entrypoint script
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pre-create dirs with correct ownership for image-layer defaults
RUN mkdir -p /data && chown limbo:limbo /data
RUN mkdir -p /home/limbo/.openclaw && chown limbo:limbo /home/limbo/.openclaw
RUN chown limbo:limbo /app

# Data volume — vault, db, config, memory, backups, logs
VOLUME ["/data"]

# OpenClaw gateway port
EXPOSE 18789

# Run as non-root limbo user
USER limbo

ENTRYPOINT ["/entrypoint.sh"]
