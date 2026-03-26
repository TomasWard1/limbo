# Limbo

[![npm](https://img.shields.io/npm/v/limbo-ai?color=blue&label=release)](https://www.npmjs.com/package/limbo-ai)
[![build](https://img.shields.io/github/actions/workflow/status/TomasWard1/limbo/ci.yml?branch=staging&label=build)](https://github.com/TomasWard1/limbo/actions)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS-lightgrey)](.)
[![docker](https://img.shields.io/badge/docker-%E2%9C%93-blue)](https://github.com/TomasWard1/limbo/pkgs/container/limbo)

A personal memory agent. Captures ideas, remembers things, and connects knowledge across time — running in a Docker container, accessible via Telegram or the ZeroClaw gateway.

Limbo is a second brain with a conversational interface. It stores atomic notes in a local vault, searches them semantically, and maintains Maps of Content (MOCs) to keep knowledge navigable.

---

## Install

> Limbo is designed to run on a VPS (always-on, accessible from anywhere). A $5/month Ubuntu server is all you need.

### 1. Provision a server

Any Ubuntu/Debian VPS with 1 GB+ RAM.

### 2. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/TomasWard1/limbo/main/scripts/install.sh | bash
```

This installs Docker, Node.js, and the Limbo CLI.

### 3. Start Limbo

```bash
limbo start
```

The setup wizard walks you through:
- [ ] Choose a language (English / Español)
- [ ] Select a provider (Anthropic, OpenAI, OpenRouter)
- [ ] Authenticate (API key or Claude/ChatGPT subscription)
- [ ] Pick a model
- [ ] Connect Telegram (optional but recommended)
- [ ] Enable voice messages and web search (optional)
- [ ] Review and confirm

Once complete, Limbo restarts and is ready to use.

### 4. Update

```bash
limbo update
```

Pulls the latest image and restarts. Vault data is persisted and not affected.

---

## Local Install (macOS/Linux)

If you prefer running locally instead of a VPS:

```bash
npx limbo-ai start
```

Requires [Docker Desktop](https://docs.docker.com/get-docker/) and Node.js 18+. Binds to `127.0.0.1:18789`.

---

## Commands

```sh
limbo start                  # Install and start (enters wizard on first run)
limbo stop                   # Stop the container
limbo update                 # Pull latest image and restart
limbo status                 # Show container status
limbo logs                   # Tail container logs
limbo start --reconfigure    # Re-run the setup wizard
limbo config voice --enable --api-key gsk_xxx   # Enable voice transcription
limbo config web-search --enable --api-key BSA_xxx  # Enable web search
```

---

## Connecting

### Telegram (recommended)

The setup wizard walks you through creating a Telegram bot and pairing it. Message your bot and Limbo responds — full agent with personality, memory logic, and vault tools.

### ZeroClaw gateway

Any [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw)-compatible client can connect via WebSocket:

```
ws://localhost:18789
```

### MCP (for other AI agents)

Add Limbo as an MCP server to give another agent direct vault access:

```json
{
  "mcpServers": {
    "limbo": {
      "url": "ws://localhost:18789"
    }
  }
}
```

This exposes 4 vault tools (`vault_search`, `vault_read`, `vault_write_note`, `vault_update_map`). The connecting agent operates on the vault directly — Limbo's LLM is not involved.

---

## Optional Features

Enable during the setup wizard or anytime via CLI.

### Voice Messages

Transcribe Telegram voice notes using [Groq](https://groq.com) Whisper.

```sh
limbo config voice --enable --api-key gsk_xxx
limbo config voice --disable
```

### Web Search

Real-time web search via [Brave Search API](https://brave.com/search/api/).

```sh
limbo config web-search --enable --api-key BSAxxx
limbo config web-search --disable
```

---

## Hardware Requirements

| Tier | RAM | vCPU | Disk |
|------|-----|------|------|
| Minimum | 512 MB | 1 | 1 GB |
| Recommended | 1 GB | 1 | 5 GB |
| With other services | 2 GB | 1 | 10 GB |

Limbo uses ~35 MB at rest, peaks ~70 MB during cold starts. CPU usage is negligible.

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

- **ZeroClaw** — Rust runtime (~5 MB RAM) handling connections, LLM routing, Telegram, and MCP tools
- **MCP server** — Node.js vault read/write tools, spawned by ZeroClaw
- **Vault** — plain markdown with YAML frontmatter, persisted in a Docker volume

---

## Agent Installation (headless)

For CI/CD or automated provisioning:

```bash
npx limbo-ai start --provider anthropic --api-key sk-ant-xxx --model claude-sonnet-4-6
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--provider` | yes | — | `anthropic`, `openai`, or `openrouter` |
| `--api-key` | yes | — | Provider API key |
| `--model` | no | Provider default | Model name |
| `--language` | no | `en` | `en` or `es` |

Headless mode skips Telegram. Add it later with `limbo start --reconfigure`.

> Subscription auth (Claude Code, ChatGPT Plus) requires the interactive wizard.

---

## Environment Variables

Managed by `limbo start`, stored in `~/.limbo/.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `api-key` | `api-key` or `subscription` |
| `MODEL_PROVIDER` | `anthropic` | `anthropic`, `openai`, `openai-codex`, or `openrouter` |
| `MODEL_NAME` | `claude-sonnet-4-6` | Model to use |
| `TELEGRAM_ENABLED` | `false` | Enable Telegram integration |
| `VOICE_ENABLED` | `false` | Enable Groq voice transcription |
| `WEB_SEARCH_ENABLED` | `false` | Enable Brave web search |

---

## Development

```sh
# Run MCP server locally
cd mcp-server && npm install && VAULT_PATH=./dev-vault node index.js

# Build image locally
docker build -t limbo:dev . && docker compose up -d

# Run tests
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for release and deployment process.
