# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────
# Stage 1: deps — install OpenClaw and MCP server deps
# ──────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /build

# Install OpenClaw globally
RUN npm install -g openclaw

# Copy MCP server and install its deps
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
RUN cd mcp-server && npm ci --omit=dev

# ──────────────────────────────────────────────
# Stage 2: final runtime image
# ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Non-root user for security
RUN addgroup -S limbo && adduser -S limbo -G limbo

# Copy OpenClaw from deps stage (global npm install)
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=deps /usr/local/bin/openclaw /usr/local/bin/openclaw

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

# Entrypoint script (runs as root so it can set up /data, then drops to limbo)
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pre-create /data with correct ownership so the non-root user can write to it
# The actual subdirectories are created by entrypoint.sh on first run
RUN mkdir -p /data && chown limbo:limbo /data

# Data volume — vault, db, config, memory, backups, logs
VOLUME ["/data"]

# OpenClaw gateway port
EXPOSE 18789

# Drop to non-root
USER limbo

ENTRYPOINT ["/entrypoint.sh"]
