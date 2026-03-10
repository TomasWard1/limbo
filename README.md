# Limbo

A personal memory agent. Captures ideas, remembers things, and connects knowledge across time — running quietly in a Docker container, accessible via Telegram or the OpenClaw gateway.

## What it is

Limbo is a second brain with a conversational interface. It stores atomic notes in a local vault, searches them semantically, and maintains Maps of Content (MOCs) to keep knowledge navigable. It is not a general-purpose assistant — it is a memory system.

**Agent personality:** defined in `workspace/IDENTITY.md` and `workspace/SOUL.md`, baked into the image at build time.

---

## Quick Start (Docker Compose)

```sh
# 1. Copy the env template
cp .env.example .env

# 2. Fill in your credentials (see Environment Variables below)
$EDITOR .env

# 3. Start
docker compose up -d

# 4. Check health
docker compose ps
```

Limbo binds to `127.0.0.1:18789`. Connect via the OpenClaw gateway or Telegram bot.

---

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | **yes** | — | API key for the Claude model |
| `MODEL_PROVIDER` | no | `anthropic` | Model provider |
| `MODEL_NAME` | no | `claude-sonnet-4-6` | Model name |
| `TELEGRAM_ENABLED` | no | `false` | Enable Telegram bot integration |
| `TELEGRAM_BOT_TOKEN` | no | — | Telegram bot token (required if `TELEGRAM_ENABLED=true`) |

---

## MCP Tools

Limbo exposes 4 tools via the `limbo-vault` MCP server:

| Tool | Description |
|------|-------------|
| `vault_search` | Search notes by regex or keyword |
| `vault_read` | Read a note by ID (returns raw markdown + frontmatter) |
| `vault_write_note` | Create or overwrite a note with structured frontmatter |
| `vault_update_map` | Append entries to a Map of Content (MOC) |

Full tool specs in `workspace/TOOLS.md`.

---

## Architecture

```
┌─────────────────────────────────────────┐
│              Docker Container           │
│                                         │
│  ┌─────────────┐    ┌────────────────┐  │
│  │  OpenClaw   │◄──►│  Claude (LLM)  │  │
│  │  Gateway    │    └────────┬───────┘  │
│  │  :18789     │             │          │
│  └──────┬──────┘    ┌────────▼───────┐  │
│         │           │  MCP Server    │  │
│  Telegram Bot        │  limbo-vault  │  │
│         │           └────────┬───────┘  │
│         └────────────────────┤          │
│                              ▼          │
│                      /data/vault/       │
│                      (markdown notes)   │
└─────────────────────────────────────────┘
```

- **OpenClaw** — gateway that wraps the Claude API with MCP tool support and optional Telegram integration
- **MCP server** — Node.js server providing vault read/write tools
- **Vault** — plain markdown files with YAML frontmatter, persisted in a named Docker volume
- **Migrations** — lightweight Node.js migration runner for vault schema changes

**Data directory layout** (in `/data` volume):

```
/data/
  vault/      # markdown notes
  db/         # sqlite (future use)
  logs/       # startup and runtime logs
  backups/    # snapshots
  memory/     # agent memory
  config/
    USER.md   # per-user persona file (generated at runtime)
```

---

## Development Setup

### Prerequisites

- Docker + Docker Compose
- Node.js 22+ (for local MCP server dev)

### Run MCP server locally

```sh
cd mcp-server
npm install
VAULT_PATH=./dev-vault node index.js
```

### Build image locally

```sh
docker build -t limbo:dev .
docker run --rm -e ANTHROPIC_API_KEY=sk-... -p 18789:18789 limbo:dev
```

### Run migrations standalone

```sh
node migrations/index.js
```

---

## Connecting

**Via OpenClaw (direct):**
Point any OpenClaw-compatible client at `ws://localhost:18789`.

**Via Telegram:**
Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `.env`, then message your bot.
