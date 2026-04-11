# Security

## Container Security Model

Limbo runs inside a Docker container with the following hardening:

- **Non-root user**: The `limbo` user (UID/GID created at build time) runs all processes
- **Read-only filesystem**: Container root filesystem is immutable (`read_only: true`)
- **No new privileges**: `no-new-privileges` seccomp flag prevents privilege escalation
- **Capabilities dropped**: All Linux capabilities are dropped (`cap_drop: ALL`)
- **Process limit**: PID limit of 200 prevents fork bombs
- **Loopback binding**: Gateway only listens on `127.0.0.1` — not exposed to LAN
- **Writable paths**: Only `/data` (volume), `/home/limbo/.openclaw` (volume), `/tmp` (tmpfs), and `/home/limbo/.npm` (tmpfs) are writable

## What Agents Can Access

Inside the container, the AI agent can:

- Read and write vault notes in `/data/vault/` (via MCP tools only)
- Execute MCP tools registered through OpenClaw native MCP (vault_search, vault_read, vault_write_note, vault_update_map)
- Search the web and fetch URLs (`web_search`, `web_fetch` — enabled for recommendations, link previews, etc.)
- Respond to Telegram messages (if enabled, with pairing required)
- Make network requests to AI provider APIs (Anthropic, OpenAI, OpenRouter)

## What Agents Cannot Do

- **Execute shell commands**: `exec` tool is denied + set to `security: "deny"`
- **Browse the web**: `browser` tool is denied
- **Read/write arbitrary files**: `group:fs` is denied, `fs.workspaceOnly` enforced
- **Modify gateway config**: `gateway` tool is denied
- **Create scheduled jobs**: `cron` tool is denied
- **Spawn sub-agents**: `sessions_spawn` and `sessions_send` are denied
- **Use elevated mode**: `elevated.enabled: false`
- **Escape the container**: Read-only root filesystem + all capabilities dropped
- **Escalate privileges**: `no-new-privileges` seccomp flag
- **Access host filesystem**: Only the bind-mounted vault directory is accessible
- **Spawn unlimited processes**: PID limit of 200

## OpenClaw Tool Policy

The agent runs with the most restrictive tool profile. On top of that:

- **Allowed**: `web_search`, `web_fetch` (for link previews, shopping recommendations, general web queries)
- **Denied**: `exec`, `browser`, `canvas`, `nodes`, `cron`, `gateway`, `sessions_spawn`, `sessions_send`, `process`, `image`, `group:automation`, `group:runtime`, `group:fs`
- **Exec**: `security: "deny"`, `ask: "always"`
- **Elevated mode**: disabled
- **Filesystem**: workspace-only

The agent can interact with users via messaging, access vault data through the MCP server, and search/fetch web content. It cannot execute commands, access the filesystem directly, modify the gateway config, or spawn sub-agents.

## API Key Storage

All tokens (LLM API keys, Telegram bot token, Groq, Brave, Google OAuth, etc.) live in a single file:

- **Location**: `~/.limbo/config/.env` with `0600` permissions (user read/write only)
- **Bind-mounted** into the container at `/data/config/.env` (user-owned on the host, world-writable inside because uid 999 ≠ host uid on the bind mount)
- **Sourced at container boot**: `scripts/entrypoint.sh` runs `set -a; . /data/config/.env; set +a` before doing anything else, so all tokens are in `process.env` for any child process
- **Automatic migration**: older installs that used `~/.limbo/secrets/*` (plain files) or `/run/secrets/*` (Docker compose secrets) get migrated into `.env` on first `limbo start` after upgrade. The legacy files are left in place for rollback; `~/.limbo/.secrets-migrated` is touched once migration succeeds so the scan is skipped on subsequent starts.

Earlier versions used Docker Compose secrets (`/run/secrets/<name>`). That layer was removed in favor of `env_file:` to simplify permissions and eliminate a class of upgrade bugs where secrets existed in three parallel places at once. The effective threat model is unchanged: tokens are owner-readable, never printed to logs, never committed to the vault, and the container runs as a non-root user.

## Supervisor Control Plane

The `limbo connect-calendar` / `limbo switch-brain` commands talk to the running container via an HTTP control plane:

- **Transport**: TCP `127.0.0.1:LIMBO_PORT+2` (default `127.0.0.1:18791`) inside the container, published via Docker port mapping
- **Host-side bind**: `127.0.0.1:PORT:PORT` — LAN peers cannot reach the port, only local processes on the host
- **DNS rebinding defence**: control-server rejects requests whose `Host:` header is not `127.0.0.1` / `localhost` / `::1` with 403
- **No token auth**: the loopback bind IS the boundary. Adding a token would only differentiate same-host users from each other — not a threat vector in Limbo's single-operator model (personal laptop / dedicated VPS). Wizard sessions themselves still use per-session tokens for the actual UI.
- **Concurrency**: only one wizard session can be live at a time (second POST returns 409). This prevents the class of port-collision bugs where two wizards fight for `LIMBO_PORT+1`.

## OpenClaw Security

Limbo uses OpenClaw in a **personal assistant trust model** (one trusted operator per gateway). Key settings in `openclaw.json`:

- `"host": "127.0.0.1"` — loopback only, no LAN exposure
- `"allowPublicBind": false` — prevents binding to all interfaces
- `"auth.mode": "token"` — all WebSocket clients must present a valid token
- `"auth.token": "<value from GATEWAY_TOKEN env>"` — the regen script injects the token directly via node (no file reads)
- `"session.dmScope": "per-channel-peer"` — DM sessions are isolated per sender (when using Telegram)
- `"channels.telegram.dmPolicy": "pairing"` — unknown Telegram senders must be explicitly approved

## Network Access

The container can make outbound HTTPS requests to:

- AI provider APIs (api.anthropic.com, api.openai.com, openrouter.ai)
- Telegram Bot API (api.telegram.org) — if Telegram is enabled
- Arbitrary URLs via `web_search` and `web_fetch` tools (for user-requested link previews, recommendations, etc.)

For stricter environments, Limbo supports an optional Squid proxy sidecar (`--hardened` flag) that restricts outbound traffic to an allowlist of AI provider domains only. Note: `--hardened` mode disables `web_fetch` functionality since the proxy blocks non-allowlisted domains.

## Input Validation

The MCP server applies the following protections:

- **Path traversal**: All file operations resolve paths and verify they don't escape the vault directory
- **ID sanitization**: Note and map IDs are restricted to alphanumeric characters, dashes, and underscores
- **Search queries**: User input is always escaped (no raw regex execution) with a 200-character limit to prevent ReDoS

## Known Limitations

- **Prompt injection**: AI agents can be manipulated by carefully crafted input. The container sandbox limits blast radius, but agents may still misuse their available tools within the vault
- **Vault data exposure**: Anything stored in vault notes is accessible to the agent. Do not store passwords, private keys, or other high-sensitivity secrets in notes
- **Single trust boundary**: The container runs one agent with one set of credentials. All tools and data inside the container share the same trust level
- **Web fetch exfiltration**: The agent can read vault notes and fetch arbitrary URLs. A successful prompt injection could theoretically exfiltrate vault data via crafted URLs. Mitigation: DM pairing limits who can trigger the bot, strong models resist injection, and API keys are stored in a 0600 `.env` file (not in the vault). Do not store high-sensitivity data in vault notes
- **Outbound network**: The agent can reach any internet destination via `web_search`/`web_fetch`. Use `--hardened` mode for strict egress filtering (disables web_fetch)

## Reporting Vulnerabilities

If you discover a security vulnerability in Limbo:

1. **Do not** open a public issue
2. Email the maintainer directly (see repository contact info)
3. Include: description, reproduction steps, affected version, and impact assessment
4. We will acknowledge within 48 hours and work on a fix

For vulnerabilities in OpenClaw itself, follow their responsible disclosure process at https://github.com/openclaw-ai/openclaw/security
