# Limbo Skill — AI Agent Integration Guide

Use this file when you need to interact with a running Limbo instance — either to query memory, store information, or understand what Limbo is and how to connect.

---

## What Limbo Is

Limbo is a personal memory agent with a conversational interface. It stores atomic notes in a local vault with semantic search and organizes them into Maps of Content (MOCs). It runs as a Docker container and is accessible via:

- **Conversational chat**: OpenClaw gateway WebSocket at port 18789
- **Telegram**: optional bot integration for mobile access
- **MCP tools**: internal vault tools (stdio, available inside the container)

Limbo remembers things for you across sessions. It uses atomic note-taking (one idea per note), maintains MOC index files, and searches by regex/keyword across all stored notes.

---

## Connection Models

### Model A — Conversational Client (OpenClaw WebSocket) — *recommended*

When you connect to `ws://localhost:18789`, you're connecting to the **OpenClaw gateway** — Limbo's conversational interface. This is the designed integration point for external agents.

> **Important:** Port 18789 does NOT speak MCP protocol. It speaks the OpenClaw agent communication protocol. Do not add it as an MCP server in `mcp.json`.

**To connect as an OpenClaw client:**

```bash
# Using openclaw CLI (if installed):
openclaw connect ws://localhost:18789 --token <OPENCLAW_GATEWAY_TOKEN>
```

**Authentication:** The gateway requires a bearer token. This is set via the `OPENCLAW_GATEWAY_TOKEN` environment variable when the container starts. If not pre-set, the container generates one at startup (check container logs: `docker logs <container_name> | grep GATEWAY_TOKEN`).

**Use this model when:**
- You want to ask Limbo questions in natural language ("What do I know about X?")
- You want Limbo to store information on your behalf
- You want to interact as a user, with Limbo managing the vault tools internally

---

### Model B — Direct MCP Vault Tools (stdio) — *advanced*

The MCP server (`/app/mcp-server/index.js` inside the container) exposes vault tools directly via stdio MCP protocol. This is used internally by mcporter for Limbo's own agent persona.

**To use it inside the container:**

```bash
docker exec -i <container_name> node /app/mcp-server/index.js
```

You can also invoke individual tools via mcporter (inside the container):

```sh
mcporter call limbo-vault.vault_search query="your search term"
mcporter call limbo-vault.vault_read noteId="note-id"
```

**Use this model when:**
- You're running inside the container (e.g., as a Paperclip agent with container access)
- You need programmatic tool-use rather than conversational interaction
- You want to bypass Limbo's persona and interact with raw vault data

---

## Vault Tools Reference

All four vault tools are available through the MCP server:

### `vault_search`
Search notes by regex or keyword query.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Regex or keyword to search across all vault notes |

Returns: matching notes with IDs, titles, snippets, and relevance scores.

---

### `vault_read`
Read the full content of a note by ID.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | Note filename without `.md` extension |

Returns: raw markdown including YAML frontmatter.

---

### `vault_write_note`
Create or overwrite a vault note.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier (lowercase kebab-case, e.g. `meeting-alex-2026-03`) |
| `title` | string | yes | Human-readable note title |
| `type` | string | yes | `claim`, `source`, `concept`, `question`, `person`, `project`, `event` |
| `description` | string | yes | One-sentence summary of the note's core claim |
| `content` | string | yes | Full markdown body |
| `map` | string | no | MOC name this note belongs to |

---

### `vault_update_map`
Append entries to a section in a Map of Content.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `map` | string | yes | Map filename without extension |
| `section` | string | yes | Section heading to append under |
| `entries` | string[] | yes | Markdown link strings, e.g. `["[[note-id|Note Title]]"]` |

---

## Interaction Guidance

When talking to Limbo through the OpenClaw gateway:

- **Ask before assuming**: Limbo searches its vault before answering recall questions. Ask "Do you remember when I told you about X?" rather than assuming it knows.
- **Be explicit about storage**: Say "remember this" or "save this" to trigger note creation. Limbo will search for duplicates before writing.
- **Reference by concept, not by note ID**: Use natural language queries. Limbo finds the relevant notes and synthesizes them.
- **Limbo uses atomic notes**: If you share multiple distinct facts in one message, Limbo may create multiple notes. This is intentional.

---

## Is a CLAUDE.md Needed?

**No.** For agents connecting to Limbo as a conversational client, this skill file is sufficient. Add it to your skills directory and invoke it when working with a Limbo instance.

A project-level CLAUDE.md is only needed if you're working on the Limbo codebase itself (backend development, Dockerfile changes, etc.) — in that case, read `PROJECT.md` in the repo root.

---

## Quick Start

```bash
# 1. Start Limbo
docker compose up -d

# 2. Get the gateway token
docker logs limbo 2>&1 | grep -i token

# 3. Connect (conversational)
openclaw connect ws://localhost:18789 --token <token>

# 4. Ask Limbo something
# > "What do I know about project X?"
# > "Remember that I met Alice on March 12th — she's the new VP of Engineering at Acme."
```
