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

Limbo binds to `127.0.0.1:18789`. Connect via the OpenClaw gateway or Telegram bot.

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

To pull the latest Limbo image and restart:

```sh
npx limbo-ai update
```

This runs `docker compose pull` followed by `docker compose up -d` in `~/.limbo`. Your vault data is persisted in the `limbo-data` Docker volume and is not affected by updates.

---

## Agent Instructions

Limbo exposes an MCP server on the running container. To connect an AI agent (Claude Code, Claude Desktop, or any OpenClaw-compatible client) to your Limbo instance, point it at the WebSocket gateway:

```
ws://localhost:18789
```

### Claude Code (MCP config)

Add to your project's `.claude/mcp.json` or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "limbo": {
      "url": "ws://localhost:18789"
    }
  }
}
```

### OpenClaw (direct)

Point any OpenClaw-compatible client at `ws://localhost:18789`.

### Telegram

Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `~/.limbo/.env`, then restart:

```sh
npx limbo-ai start --reconfigure
```

---

## Release Channel (GHCR)

Stable deploys should use a pinned semver image tag via `LIMBO_IMAGE_TAG`.

- Release workflow source: `.github/workflows/release-ghcr.yml`
- Published tags per release tag `vX.Y.Z`:
  - `ghcr.io/tomasward1/limbo:X.Y.Z`
  - `ghcr.io/tomasward1/limbo:X`
  - `ghcr.io/tomasward1/limbo:latest`

Create a release tag:

```sh
git tag -a v1.0.0 -m "Limbo v1.0.0"
git push origin v1.0.0
```

Verify public pull (no credentials):

```sh
docker logout ghcr.io
docker manifest inspect ghcr.io/tomasward1/limbo:1.0.0
docker pull ghcr.io/tomasward1/limbo:1.0.0
```

---

## Environment Variables

Managed automatically by `npx limbo-ai start`, stored in `~/.limbo/.env`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | **yes*** | — | API key for your chosen model provider (Anthropic or OpenAI) |
| `ANTHROPIC_API_KEY` | **yes*** | — | Legacy alias for `LLM_API_KEY` — accepted for backwards compatibility |
| `MODEL_PROVIDER` | no | `anthropic` | Model provider: `anthropic` or `openai` |
| `MODEL_NAME` | no | `claude-sonnet-4-6` | Model name (e.g. `claude-sonnet-4-6`, `codex-mini-latest`, `gpt-4o`) |
| `TELEGRAM_ENABLED` | no | `false` | Enable Telegram bot integration |
| `TELEGRAM_BOT_TOKEN` | no | — | Telegram bot token (required if `TELEGRAM_ENABLED=true`) |
| `TELEGRAM_AUTO_PAIR_FIRST_DM` | no | `true` | Auto-approves the first Telegram DM sender and persists access (MVP-friendly onboarding) |

> \* Either `LLM_API_KEY` **or** `ANTHROPIC_API_KEY` is required. `LLM_API_KEY` takes precedence if both are set.

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
docker run --rm -e LLM_API_KEY=sk-ant-... -p 18789:18789 limbo:dev
```

### Run migrations standalone

```sh
node migrations/index.js
```
