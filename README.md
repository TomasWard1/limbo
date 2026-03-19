# Limbo

A personal memory agent. Captures ideas, remembers things, and connects knowledge across time — running quietly in a Docker container, accessible via Telegram or the ZeroClaw gateway.

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

### Agent Installation

AI agents can install Limbo non-interactively using CLI flags:

```bash
npx limbo-ai start --provider openrouter --api-key sk-or-v1-xxx --model auto
```

**Required flags:**
| Flag | Description |
|------|-------------|
| `--provider` | `openai`, `anthropic`, or `openrouter` |
| `--api-key` | Your provider API key |

**Optional flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--model` | Provider default | Model name (e.g. `anthropic/claude-sonnet-4-6`) |
| `--language` | `en` | CLI language (`en` or `es`) |

Headless mode skips Telegram setup. To add Telegram later, run `npx limbo-ai start --reconfigure`.

> **Note:** Subscription-based auth (ChatGPT/Codex, Claude Code) requires interactive setup because it involves browser-based OAuth or token pasting. Use `npx limbo-ai start` without flags for subscription auth.

### Available commands

```sh
npx limbo-ai@latest start        # Install and start (default if no command given)
npx limbo-ai@latest stop         # Stop the container
npx limbo-ai@latest update       # Pull latest image and restart
npx limbo-ai@latest status       # Show container status
npx limbo-ai@latest logs         # Tail container logs
npx limbo-ai@latest start --reconfigure   # Change API keys or settings
npx limbo-ai@latest config               # Configure optional features (voice, web-search)
```

---

## Optional Features

Limbo supports optional features that can be enabled during the setup wizard (step 7) or anytime via the CLI.

### Voice Messages

Transcribe Telegram voice notes using [Groq](https://groq.com) Whisper. Requires a Groq API key (`gsk_...`).

```sh
npx limbo-ai@latest config voice --enable --api-key gsk_xxx
npx limbo-ai@latest config voice --status
npx limbo-ai@latest config voice --disable
```

### Web Search

Give Limbo real-time web search via the [Brave Search API](https://brave.com/search/api/). Requires a Brave API key (`BSA...`).

```sh
npx limbo-ai@latest config web-search --enable --api-key BSAxxx
npx limbo-ai@latest config web-search --status
npx limbo-ai@latest config web-search --disable
```

Both features store API keys as Docker secrets and toggle config sections in the container on restart.

---

## Updating

```sh
npx limbo-ai@latest update
```

Pulls the latest Limbo image and restarts the container. Your vault data is persisted in the `limbo-data` Docker volume and is not affected.

---

## Connecting

There are two ways to connect: **talk to Limbo** (conversational, with its personality and memory logic) or **use the vault directly** (raw tool access from another agent).

### Talk to Limbo

#### Telegram (recommended)

During setup (`npx limbo-ai start`), the wizard will walk you through creating a Telegram bot via BotFather and pairing it. Message your bot and Limbo will respond — full agent with personality, memory logic, and vault tools.

#### ZeroClaw gateway

Any [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw)-compatible chat client can connect to:

```
ws://localhost:18789
```

This gives you a conversational session with Limbo, same as Telegram but over WebSocket.

### Use the vault from another agent

If you want another AI agent (like Claude Code) to read and write to Limbo's vault directly — without going through Limbo's personality or reasoning — add it as an MCP server:

```json
{
  "mcpServers": {
    "limbo": {
      "url": "ws://localhost:18789"
    }
  }
}
```

This exposes the 4 vault tools (`vault_search`, `vault_read`, `vault_write_note`, `vault_update_map`) as MCP tools in the connecting agent. The agent operates on the vault directly — Limbo's LLM is not involved.

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
| `VOICE_ENABLED` | no | `false` | Enable voice transcription (requires Groq API key as Docker secret) |
| `WEB_SEARCH_ENABLED` | no | `false` | Enable web search (requires Brave API key as Docker secret) |

> \* API keys are required only for `AUTH_MODE=api-key`. Subscription auth uses ZeroClaw auth profiles instead.

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
│  │  ZeroClaw   │◄──►│  LLM (Claude   │  │
│  │  daemon     │    │  or OpenAI)    │  │
│  │  :18789     │    └────────┬───────┘  │
│  └──────┬──────┘             │          │
│         │           ┌────────▼───────┐  │
│  Telegram Bot       │  MCP Server    │  │
│         │           │  limbo-vault   │  │
│         │           └────────┬───────┘  │
│         └────────────────────┤          │
│                              ▼          │
│                      /data/vault/       │
│                      (markdown notes)   │
└─────────────────────────────────────────┘
```

- **ZeroClaw** — lightweight Rust runtime (~5MB RAM) that handles client connections, routes to the LLM, manages Telegram, and integrates MCP tools natively
- **MCP server** — Node.js server providing vault read/write tools (spawned by ZeroClaw, no mcporter needed)
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
docker compose up -d
```

### Run migrations standalone

```sh
node migrations/index.js
```

---

See [CONTRIBUTING.md](./CONTRIBUTING.md) for release and deployment process.
