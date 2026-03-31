# Limbo — Architecture Reference

> This file is loaded by AI assistants to avoid re-scanning the codebase every session.
> Keep it updated when structure changes. Last verified: 2026-03-29.

## What Is Limbo

Self-hosted personal AI memory agent. Runs as a Docker container exposing a ZeroClaw gateway (WebSocket on :18789). Users interact via Telegram. The agent stores and retrieves knowledge from a markdown vault using MCP tools.

**Stack**: ZeroClaw (Rust agent runtime, custom fork) + Node.js MCP server + SQLite FTS5 + Telegram bot.

**Published as**: `limbo-ai` on npm — the CLI (`npx limbo-ai`) handles install, start, stop, update, and setup.

## High-Level Flow

```
User (Telegram) → ZeroClaw Gateway (:18789) → LLM (configurable provider)
                                                    ↓
                                              MCP Tools (stdio)
                                                    ↓
                                         Vault (markdown + SQLite FTS5)
```

## Directory Structure

```
limbo/
├── cli.js                    # Main CLI (84KB) — install, start, stop, update, configure
├── Dockerfile                # Multi-stage: deps → zeroclaw binary → runtime (node:22-slim)
├── config.toml.template      # ZeroClaw config — rendered by entrypoint via envsubst
├── docker-compose.yml        # Production reference (generated per-user into ~/.limbo)
├── docker-compose.dev.yml    # Local dev
├── docker-compose.test.yml   # Local testing
├── package.json              # npm package: limbo-ai v1.20.4
│
├── mcp-server/               # Node.js MCP server (JSON-RPC 2.0 over stdio)
│   ├── index.js              # Entry point — tool routing, vault init, FTS setup
│   ├── vault-index.js        # In-memory vault index (walks markdown files + YAML frontmatter)
│   ├── fts.js                # SQLite FTS5 — BM25 scoring, title-weighted, WAL mode
│   └── tools/                # One file per MCP tool
│       ├── search.js         # vault_search — FTS5 full-text search
│       ├── read.js           # vault_read — O(1) lookup via in-memory index
│       ├── write.js          # vault_write_note — create/update with YAML frontmatter
│       ├── update-map.js     # vault_update_map — append entries to MOCs
│       ├── store-file.js     # vault_store_file — binary files (images/PDFs) + linked note
│       └── get-file.js       # vault_get_file — retrieve stored files as base64
│
├── workspace/                # Agent persona files (injected into ZeroClaw context)
│   ├── system/               # Product-owned, root-owned, reset every boot
│   │   ├── AGENTS.md         # Behavioral workflows and rules
│   │   ├── TOOLS.md          # Tool usage instructions
│   │   └── limbo-skill.md    # Agent skill definitions
│   └── templates/            # User-owned, seeded on first run only
│       ├── IDENTITY.md
│       ├── SOUL.md
│       └── USER.md.template  # Rendered with envsubst on first run
│
├── setup-server/             # Zero-dependency HTTP setup wizard (pure Node.js)
│   └── server.js             # Serves on :18789 until config complete, then exits
│
├── migrations/               # Data migration runner
│   ├── index.js              # Runner — executes versioned migrations sequentially
│   └── versions/             # Individual migration files (4 versions)
│
├── scripts/
│   ├── entrypoint.sh         # Container startup (13KB) — 12-stage orchestration
│   ├── build-zeroclaw.sh     # Custom ZeroClaw image builder (multi-platform)
│   └── install.sh            # Server provisioning (Ubuntu/Debian)
│
├── evals/                    # End-to-end eval framework
│   ├── cli.js                # Eval runner (28KB) — run, compare, promote, judge
│   ├── docker-compose.eval.yml
│   ├── cases/                # 20+ JSON test cases (search, create, multi-step, speed)
│   ├── vault-seed/           # Pre-populated vault for deterministic eval runs
│   ├── judge/                # LLM-as-judge rubrics
│   ├── lib/                  # Shared eval utilities
│   ├── dashboard/            # Web UI for results
│   ├── results/              # Run outputs + baselines/
│   └── scripts/              # Eval helper scripts
│
├── test/                     # Unit tests (node --test)
│   ├── cli-filter.test.js
│   ├── cli-auth.test.js
│   ├── zeroclaw-migration.test.js
│   ├── setup-server.test.js
│   └── cli-wizard-parity.test.js
│
├── docs/                     # Public documentation
├── agents/                   # Paperclip agent configs (not deployed in Limbo)
└── squid/                    # Squid proxy config (for container network access)
```

## Docker Build (3 stages)

1. **deps** (node:22-slim) — `npm ci` + compile better-sqlite3 native addon
2. **zeroclaw** — copies binary from custom image `ghcr.io/tomasward1/zeroclaw:<ver>-custom`
3. **runtime** (node:22-slim) — non-root `limbo` user, copies app + binary + node_modules

**Data volume**: `/data` — contains vault/, db/, config/, logs/, backups/, memory/

**Build arg**: `ZEROCLAW_IMAGE` — override to test custom ZeroClaw builds locally.

## Entrypoint Flow (scripts/entrypoint.sh)

12-stage startup:
1. Directory setup (`/data/*`)
2. Secrets sync (`/run/secrets/` → `$ZEROCLAW_STATE_DIR/secrets/`)
3. First-run detection (presence of `.env` in /data)
4. Setup wizard (if no `MODEL_PROVIDER` in .env → serve wizard on :18789)
5. Workspace file seeding (templates → /data, system files symlinked)
6. Config template rendering (envsubst on config.toml.template)
7. Feature sections (Telegram, Voice, Web Search) conditionally appended to config.toml
8. Auth profiles generation
9. Migration runner
10. FTS index build
11. MCP server registration
12. ZeroClaw launch

## MCP Server Details

- **Protocol**: JSON-RPC 2.0 over stdio
- **Invoked by ZeroClaw**: `node /app/mcp-server/index.js`
- **Vault path**: `/data/vault/` (markdown files with YAML frontmatter)
- **FTS database**: `/data/db/fts.db` (SQLite, WAL mode)
- **Index**: In-memory hashmap of all vault notes, rebuilt on startup

### Frontmatter Schema

```yaml
---
id: unique-slug
title: Display Name
description: Falsifiable claim or summary
type: note|map|reminder|file
status: seed|growing|evergreen
domain: personal|tech|...
created: 2026-03-29
source: telegram|manual|...
topics:
  - "[[related-note]]"
---
```

## Key Architectural Decisions

These are documented in the vault but rarely change:

- **Extension = MCP tools, not ZeroClaw features**. New capabilities go in `mcp-server/tools/` as Node.js. Cargo features only for things that must compile into Rust (e.g., `rag-pdf`).
- **Separate container, not plugin**. Limbo is a standalone Docker container, not an OpenClaw plugin.
- **System files reset on boot, user files persist**. AGENTS.md/TOOLS.md overwrite from image; SOUL.md/IDENTITY.md/USER.md survive across container restarts.
- **Maps live in vault/maps/, notes in vault/notes/**. Separated to simplify `vault_update_map`.
- **Feature integration pattern**: wizard toggle → secret file → env var → entrypoint appends TOML section.
- **Minimal .env triggers setup wizard**. Container detects first run by absence of `MODEL_PROVIDER`.

## Eval System

- 20+ JSON test cases in `evals/cases/`
- Each case: sends message via WebSocket, asserts on tool_called + response_matches + vault_state
- Current baseline: 94.0% (FTS5 + ZeroClaw v0.6.3)
- `node evals/cli.js run` → `compare --strict` → `promote`
- Uses real LLM calls (costs tokens)

## Environment Variables

Key env vars (see `.env.example` for full list):
- `MODEL_PROVIDER` — anthropic, openai, etc.
- `TELEGRAM_ENABLED` — true/false
- `LIMBO_PORT` — gateway port (default 18789)
- `ZEROCLAW_STATE_DIR` — where ZeroClaw stores its state
- `LIMBO_EVAL` — enables MCP tool call logging

## Testing

```bash
npm test    # runs: cli-filter, cli-auth, zeroclaw-migration, setup-server, cli-wizard-parity
```

Tests use Node.js built-in test runner (`node --test`).
