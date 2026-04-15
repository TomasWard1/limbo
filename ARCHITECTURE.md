# Limbo — Architecture Reference

> This file is loaded by AI assistants to avoid re-scanning the codebase every session.
> Keep it updated when structure changes. Last verified: 2026-04-11.

## What Is Limbo

Self-hosted personal AI memory agent. Runs as a Docker container where a **supervisor** orchestrates three things: an **OpenClaw gateway** (the agent runtime, default :18789), an **on-demand wizard port** (LIMBO_PORT+1, used by `limbo connect-calendar` / `limbo switch-brain`), and a **control plane** (LIMBO_PORT+2, TCP loopback, how the host CLI talks to the container without restarting it). Users interact via Telegram. The agent stores and retrieves knowledge from a markdown vault using MCP tools.

**Stack**: OpenClaw (Node.js agent runtime) + Node.js MCP server + SQLite FTS5 + Telegram bot + Node.js supervisor (`lib/supervisor.js` + `scripts/supervisor.js`).

**Published as**: `limbo-ai` on npm — the CLI (`npx limbo-ai`) handles install, start, stop, update, and setup.

## High-Level Flow

```
User (Telegram) → OpenClaw Gateway (:LIMBO_PORT) → LLM (configurable provider)
                         │                              ↓
                         │                        MCP Tools (stdio)
                         │                              ↓
                         │                 Vault (markdown + SQLite FTS5)
                         │
    Host CLI ────────────┘
    (limbo connect-calendar / switch-brain)
         │
         ▼
    Supervisor control plane (TCP 127.0.0.1:LIMBO_PORT+2)
    HTTP API: POST /wizard · GET /wizard/:id · DELETE /wizard/:id · GET /health
         │
         ▼
    Wizard spawner — forks setup-server on LIMBO_PORT+1 on demand
    Config regen → atomic rename → OpenClaw in-process reload
```

Four ports are published per instance:
- `127.0.0.1:LIMBO_PORT:LIMBO_PORT`             — OpenClaw gateway (agent + HTTP API, loopback only)
- `127.0.0.1:LIMBO_PORT+1:LIMBO_PORT+1`         — On-demand wizard (only live during connect-calendar / switch-brain)
- `127.0.0.1:LIMBO_PORT+2:LIMBO_PORT+2`         — Supervisor control plane (host CLI ↔ supervisor)
- `0.0.0.0:80:80`                                — Public server (only when `LIMBO_PUBLIC_URL` is set — Limbo Cloud mode)

The first three are bound to host loopback — never LAN-accessible. The fourth (port 80) is only added when the instance has a public URL, and is the only internet-facing port. It serves the wizard UI (when active) or a static "use Telegram" page (when idle). Cloudflare proxy terminates TLS.

## Limbo Cloud

When `LIMBO_PUBLIC_URL` is set (e.g. `https://abc123.heylimbo.com`), the instance is in **cloud mode**:
- The supervisor starts a public HTTP server on port 80 (`lib/public-server.js`)
- Cloudflare proxies `https://{id}.heylimbo.com` → VPS port 80
- The wizard is accessible at the public URL — no SSH, no tunnels
- Google OAuth uses a relay Worker at `auth.heylimbo.com` (one registered redirect URI for all instances)
- DNS provisioning happens via a Worker at `api.heylimbo.com`

CLI commands for cloud mode:
- `limbo cloud activate` — provisions a `{id}.heylimbo.com` subdomain and enables the public server
- `limbo cloud deactivate` — removes the subdomain and disables the public server
- `limbo cloud status` — shows current cloud activation status

### Cloudflare Workers (centralized, $0/month)

| Worker | Domain | Function |
|--------|--------|----------|
| Provisioning | `api.heylimbo.com` | Creates/deletes DNS A records for instance subdomains |
| OAuth Relay | `auth.heylimbo.com` | Receives Google OAuth callback, 302 redirects to the instance |

Source: `workers/provisioning/worker.js` and `workers/auth-relay/worker.js`.

## Directory Structure

```
limbo/
├── cli.js                    # Main CLI (84KB) — install, start, stop, update, configure
├── Dockerfile                # Multi-stage: deps → runtime (node:22-slim)
├── openclaw.json.template    # OpenClaw config — rendered by entrypoint via envsubst
├── docker-compose.yml        # Production reference (generated per-user into ~/.limbo)
├── docker-compose.dev.yml    # Local dev
├── docker-compose.test.yml   # Local testing
├── package.json              # npm package: limbo-ai (CalVer, see package.json for current version)
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
├── workspace/                # Agent persona files (injected into OpenClaw context)
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
│   └── server.js             # First-run: serves on LIMBO_PORT. Incremental (connect-calendar / switch-brain):
│                             # serves on LIMBO_PORT+1, spawned by the supervisor with SETUP_TOKEN in env
│
├── lib/                      # Supervisor + control-plane modules (all pure, testable)
│   ├── supervisor.js         # Orchestrator: wires session-store + router + server + spawner + OpenClaw
│   ├── session-store.js      # In-memory state machine: pending → ready → active → done/error/timeout
│   ├── control-router.js     # Pure HTTP router (POST /wizard, GET /wizard/:id, DELETE /wizard/:id, GET /health)
│   ├── control-server.js     # TCP HTTP server (bind 0.0.0.0 in-container, host-header allowlist)
│   ├── control-client.js     # Host-side HTTP client — talks to supervisor via 127.0.0.1:CONTROL_PORT
│   ├── wizard-spawner.js     # Forks setup-server with SETUP_TOKEN + LIMBO_PORT + CONNECT_*_MODE / SWITCH_BRAIN_MODE
│   ├── cf-tunnel.js          # Cloudflare tunnel helpers (zombie sweep, DNS polling, URL builder)
│   └── telegram-notify.js    # Notification helper used by wakeup routine
│
├── migrations/               # Data migration runner
│   ├── index.js              # Runner — executes versioned migrations sequentially
│   └── versions/             # Individual migration files (6 versions)
│
├── scripts/
│   ├── entrypoint.sh         # Container startup (~15KB) — dirs, .env source, config regen, exec supervisor
│   ├── supervisor.js         # Container main process — wires real child_process.spawn into lib/supervisor.js
│   ├── regen-openclaw-config.sh  # Single source of truth for openclaw.json generation (envsubst + node -e)
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
├── test/                     # Unit tests (node --test) — see package.json "test" script
│   │                         # for the authoritative list of files run by npm test.
│   ├── cli-filter.test.js / cli-auth.test.js / cli-compose.test.js
│   ├── cli-wizard-parity.test.js
│   ├── openclaw-migration.test.js / entrypoint.test.js / update-system.test.js
│   ├── setup-server.test.js
│   ├── fts.test.js / mcp-tools.test.js / sanitize-control-chars.test.js
│   ├── session-store.test.js       # pure state machine unit tests
│   ├── control-router.test.js      # pure router unit tests (routing, 409, health)
│   ├── control-server.test.js      # TCP HTTP server integration (ephemeral ports)
│   ├── control-client.test.js      # host-side client integration
│   ├── wizard-spawner.test.js      # spawner harness (fake children)
│   ├── supervisor.test.js          # full supervisor integration (restart loop, shutdown)
│   ├── google-calendar-cli.test.js # cmdConnectCalendar regression guards
│   ├── switch-brain-cli.test.js    # cmdSwitchBrain regression guards
│   └── cf-tunnel.test.js           # cf-tunnel.js unit tests (zombie sweep, DNS polling)
│
├── docs/                     # Public documentation
├── agents/                   # Paperclip agent configs (not deployed in Limbo)
└── squid/                    # Squid proxy config (for container network access)
```

## Docker Build (2 stages)

1. **deps** (node:22-slim) — `npm ci` + compile better-sqlite3 native addon
2. **runtime** (node:22-slim) — non-root `limbo` user, copies app + node_modules (OpenClaw included as npm dependency)

**Data volume**: `/data` — contains vault/, db/, config/, logs/, backups/, memory/

## Entrypoint Flow (scripts/entrypoint.sh)

1. Directory setup (`/data/*`, `/flags`, `/home/limbo/.openclaw`)
2. **.env sourcing** — `set -a; . /data/config/.env; set +a` exports all tokens as env vars (post secrets consolidation)
3. First-run detection (absence of `MODEL_PROVIDER` in .env → setup mode)
4. Setup wizard (first-run path: exec `node /app/setup-server/server.js` directly on `LIMBO_PORT`)
5. Workspace file seeding (system files copied fresh, user templates seeded only if missing)
6. USER.md regeneration via envsubst
7. OpenClaw config generation (`sh /app/scripts/regen-openclaw-config.sh`) — envsubst + node -e to inject Telegram / Voice / Web Search / Google Calendar
8. Migration runner
9. Workspace ownership check
10. Wakeup routine (Telegram startup message)
11. **Exec supervisor** (`exec node /app/scripts/supervisor.js`) — replaces the old `exec openclaw gateway`

## Supervisor & Control Plane (lib/supervisor.js + scripts/supervisor.js)

The supervisor replaces the old direct `exec openclaw gateway` at the end of entrypoint.sh. It becomes the container's PID 2 (tini is PID 1), and it:

1. Binds the TCP control plane on `0.0.0.0:LIMBO_PORT+2` inside the container (loopback-only on the host via compose port mapping)
2. Spawns OpenClaw as a managed child with `OPENCLAW_NO_RESPAWN=1` injected into the child env
3. Listens for POST /wizard requests from the host CLI
4. On a wizard request: spawns a `setup-server` child on `LIMBO_PORT+1` with `SETUP_TOKEN` + the feature-specific mode env var (`CONNECT_CALENDAR_MODE` / `SWITCH_BRAIN_MODE` / ...) — returns the token + port to the CLI
5. Tracks the session in an in-memory state machine. CLI polls `GET /wizard/:id` until terminal
6. Observes OpenClaw clean-exit: if it happens (e.g. a real crash), **respawns it** up to 5 times in 60s. After that the supervisor shuts down.
7. Forwards SIGTERM/SIGINT from tini into a graceful `supervisor.stop()` that kills active wizards + OpenClaw in order

### Why `OPENCLAW_NO_RESPAWN=1`

OpenClaw ships with an internal config-reloader (chokidar on `openclaw.json`). For any config path that isn't explicitly classified as "hot" or "none", it triggers a **full process restart**: fork+exec a new detached OpenClaw, then the old process exits code 0. On our code path (`mcp.servers.*.env.*` after a connect-calendar / switch-brain wizard), that restart ALWAYS fires.

Without intervention, the supervisor sees the old OpenClaw exit, respawns a new one, and races the already-running OpenClaw sibling for `LIMBO_PORT` — EADDRINUSE crash loop.

`OPENCLAW_NO_RESPAWN=1` (read by OpenClaw itself at startup) switches the restart into **in-process** mode: same PID, release/reacquire the gateway lock, server reopens inside the existing process. The supervisor never sees an exit event; the restart is transparent.

The supervisor's own restart-loop (item 6 above) remains as a safety net for *real* crashes.

### Why TCP loopback, not a Unix domain socket

Original design used a Unix socket on a bind-mounted host path. Docker Desktop and OrbStack on macOS do NOT proxy AF_UNIX sockets through their file-sharing layer — virtiofs marshals file ops but not `connect(2)`. The socket file appeared on the host, but `nc -U` / `http.request({socketPath})` from the host kernel returned ECONNREFUSED because the listener lived in the Linux VM. TCP port mapping is the primitive Docker ships reliably on every platform; the security boundary is the host-side `127.0.0.1:PORT:PORT` binding + a `Host:` header allowlist in control-server.

## MCP Server Details

- **Protocol**: JSON-RPC 2.0 over stdio
- **Invoked by OpenClaw**: `node /app/mcp-server/index.js`
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

- **Extension = MCP tools, not OpenClaw core**. New capabilities go in `mcp-server/tools/` as Node.js.
- **Separate container, not plugin**. Limbo is a standalone Docker container with OpenClaw as an npm dependency.
- **System files reset on boot, user files persist**. AGENTS.md/TOOLS.md overwrite from image; SOUL.md/IDENTITY.md/USER.md survive across container restarts.
- **Maps live in vault/maps/, notes in vault/notes/**. Separated to simplify `vault_update_map`.
- **Feature integration pattern**: wizard toggle → secret file → env var → entrypoint merges JSON config section.
- **Minimal .env triggers setup wizard**. Container detects first run by absence of `MODEL_PROVIDER`.

## Eval System

- 20+ JSON test cases in `evals/cases/`
- Each case: sends message via WebSocket, asserts on tool_called + response_matches + vault_state
- Current baseline: 94.0% (FTS5 + OpenClaw)
- `node evals/cli.js run` → `compare --strict` → `promote`
- Uses real LLM calls (costs tokens)

## Environment Variables

Key env vars (see `.env.example` for full list):
- `MODEL_PROVIDER` — anthropic, openai, openrouter, etc.
- `TELEGRAM_ENABLED` — true/false
- `LIMBO_PORT` — gateway port (default 18789). The wizard port is `LIMBO_PORT+1`; the control plane is `LIMBO_PORT+2`.
- `LIMBO_CONTROL_PORT` — optional override for the control plane port (default `LIMBO_PORT+2`)
- `OPENCLAW_STATE_DIR` — where OpenClaw stores its state
- `OPENCLAW_NO_RESPAWN` — set to `1` automatically by the supervisor for OpenClaw children. Do NOT unset. See "Why OPENCLAW_NO_RESPAWN=1" above.
- `LIMBO_EVAL` — enables MCP tool call logging
- `SETUP_TOKEN` — injected into wizard children by the spawner so the setup-server uses the same token the CLI receives from `POST /wizard`

## Testing

```bash
npm test    # full unit suite (443 tests across 39 suites, ~10s on Node 22)
```

Tests use Node.js built-in test runner (`node --test`). The `package.json` `test` script is the authoritative list of files. `npm test` is also what the pre-push git hook runs — see `CONTRIBUTING.md` for the hook setup.

**Node version:** pinned to 22 via `.nvmrc`. The FTS module hits a test-pollution bug on Node ≥ 25 (closeFts nullifies a module-level singleton that subsequent test suites assume is initialized). Pin your local shell to the `.nvmrc` version before running the suite.
