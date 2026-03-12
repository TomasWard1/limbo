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

## One-Line Installer

Canonical installer URL:

```sh
https://gist.githubusercontent.com/TomasWard1/d130b8d34cc8eeb0527d045d06985396/raw/install.sh
```

Run directly:

```sh
curl -fsSL https://gist.githubusercontent.com/TomasWard1/d130b8d34cc8eeb0527d045d06985396/raw/install.sh | bash
```

Run with explicit sudo escalation:

```sh
sudo bash <(curl -fsSL https://gist.githubusercontent.com/TomasWard1/d130b8d34cc8eeb0527d045d06985396/raw/install.sh)
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

If GHCR pull is denied (for example, private package or temporary registry policy), the installer automatically falls back to building from source on the target host.

---
## Environment Variables

Copy `.env.example` to `.env` and set:

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

---

## Connecting

**Via OpenClaw (direct):**
Point any OpenClaw-compatible client at `ws://localhost:18789`.

**Via Telegram:**
Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `.env`, then message your bot.
