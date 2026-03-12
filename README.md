# Limbo

A personal memory agent. Captures ideas, remembers things, and connects knowledge across time — running quietly in a Docker container, accessible via Telegram or the OpenClaw gateway.

## What it is

Limbo is a second brain with a conversational interface. It stores atomic notes in a local vault, searches them semantically, and maintains Maps of Content (MOCs) to keep knowledge navigable. It is not a general-purpose assistant — it is a memory system.

**Agent personality:** defined in `workspace/IDENTITY.md` and `workspace/SOUL.md`, baked into the image at build time.

---

## Quick Start

Requires [Docker Desktop](https://docs.docker.com/get-docker/) and Node.js 18+.

```sh
npx limbo-ai start
```

This will:
1. Prompt for your API key (Anthropic or OpenAI)
2. Write `~/.limbo/.env` and `~/.limbo/docker-compose.yml`
3. Pull the latest Limbo image and start the container

Limbo binds to `127.0.0.1:18789`.

### Available commands

```sh
npx limbo-ai start        # Install and start (default if no command given)
npx limbo-ai stop         # Stop the container
npx limbo-ai update       # Pull latest image and restart
npx limbo-ai status       # Show container status
npx limbo-ai logs         # Tail container logs
npx limbo-ai start --reconfigure   # Change API keys or settings
```

---

## Updating

```sh
npx limbo-ai update
```

Pulls the latest Limbo image and restarts the container. Your vault data is persisted in the `limbo-data` Docker volume and is not affected.

---

## Connecting

The easiest way to talk to Limbo is via **Telegram** — set up once, works from any device.

For everything else, Limbo speaks over WebSocket at `ws://localhost:18789` via the OpenClaw gateway. Any OpenClaw-compatible client can connect there directly.

### Telegram (recommended)

Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `~/.limbo/.env`, then restart:

```sh
npx limbo-ai start --reconfigure
```

Message your bot and Limbo will respond.

### Without Telegram

Connect any [OpenClaw](https://openclaw.dev)-compatible client to:

```
ws://localhost:18789
```

This includes Claude Code — add Limbo to your MCP config:

```json
{
  "mcpServers": {
    "limbo": {
      "url": "ws://localhost:18789"
    }
  }
}
```

---

## Environment Variables

Managed automatically by `npx limbo-ai start`, stored in `~/.limbo/.env`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_MODE` | no | `api-key` | `api-key` or `subscription` |
| `OPENAI_API_KEY` | no* | — | OpenAI API key for `MODEL_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | no* | — | Anthropic API key for `MODEL_PROVIDER=anthropic` |
| `LLM_API_KEY` | no | — | Legacy generic key path for older installs |
| `MODEL_PROVIDER` | no | `anthropic` | Model provider: `anthropic`, `openai`, or `openai-codex` |
| `MODEL_NAME` | no | `claude-opus-4-6` | Model name (e.g. `claude-opus-4-6`, `claude-sonnet-4-6`, `gpt-5.4`) |
| `TELEGRAM_ENABLED` | no | `false` | Enable Telegram bot integration |
| `TELEGRAM_BOT_TOKEN` | no | — | Telegram bot token (required if `TELEGRAM_ENABLED=true`) |
| `TELEGRAM_AUTO_PAIR_FIRST_DM` | no | `true` | Auto-approves the first Telegram DM sender and persists access (MVP-friendly onboarding) |
| `OPENCLAW_GATEWAY_TOKEN` | no | generated | Stable gateway token for OpenClaw-compatible clients |

> \* API keys are required only for `AUTH_MODE=api-key`. Subscription auth uses OpenClaw auth profiles instead.

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
│  │  OpenClaw   │◄──►│  LLM (Claude   │  │
│  │  Gateway    │    │  or OpenAI)    │  │
│  │  :18789     │    └────────┬───────┘  │
│  └──────┬──────┘             │          │
│         │           ┌────────▼───────┐  │
│  Telegram Bot        │  MCP Server   │  │
│         │           │  limbo-vault  │  │
│         │           └────────┬───────┘  │
│         └────────────────────┤          │
│                              ▼          │
│                      /data/vault/       │
│                      (markdown notes)   │
└─────────────────────────────────────────┘
```

- **OpenClaw** — gateway that handles client connections, routes to the LLM, and integrates MCP tools
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
docker run --rm -e LLM_API_KEY=sk-ant-... -p 18789:18789 limbo:dev
```

### Run migrations standalone

```sh
node migrations/index.js
```

---

See [CONTRIBUTING.md](./CONTRIBUTING.md) for release and deployment process.
