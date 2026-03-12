# Limbo -- Project Reference

> Read this BEFORE exploring the repo. Do NOT use `ls`, `find`, or `cat` to rediscover the project structure.

## What Limbo Is

A personal memory agent with a conversational interface. Stores atomic notes in a local vault with semantic search, maintains Maps of Content (MOCs), runs in Docker via OpenClaw gateway, accessible via Telegram or HTTP.

## File Map

```
/
├── Dockerfile                    # Multi-stage: deps → runtime (node:22-slim)
├── docker-compose.yml            # Single service, port 18789, volume limbo-data:/data
├── openclaw.json.template        # OpenClaw config template (envsubst at runtime)
├── mcporter.json                 # MCP server registry for OpenClaw
├── scripts/
│   └── entrypoint.sh             # Creates /data dirs, runs migrations, starts OpenClaw
├── mcp-server/                   # Custom MCP server (Node.js)
│   ├── index.js                  # Server entry — registers tools
│   ├── package.json              # Dependencies
│   └── tools/
│       ├── read.js               # Read notes from vault
│       ├── write.js              # Write notes to vault
│       ├── search.js             # Semantic search across vault
│       └── update-map.js         # Update MOC files
├── migrations/
│   ├── index.js                  # Migration runner (pure Node.js, no deps)
│   └── versions/                 # SQL migration files
├── workspace/                    # Agent persona files baked into image
├── docs/                         # Business docs (market research, GTM, etc.)
└── agents/                       # Paperclip agent configs (NOT deployed in Docker)
    ├── ceo/                      # Tony Stark — CEO, Opus
    ├── friday/                   # F.R.I.D.A.Y. — DevOps, Sonnet
    ├── jarvis/                   # J.A.R.V.I.S. — Backend, Sonnet
    ├── pepper/                   # Pepper Potts — CMO, Sonnet
    └── vision/                   # Vision — Frontend, Sonnet
```

## Key Commands

```bash
# Build Docker image
docker build -t limbo:local .

# Run locally
docker compose up -d

# Run one-off for testing
docker run --rm -p 18789:18789 --env-file .env -v limbo-data:/data limbo:local

# Check OpenClaw version inside container
docker run --rm --entrypoint sh limbo:local -c "openclaw --version"

# Run migrations manually
docker exec limbo node /app/migrations/index.js
```

## Environment Variables (required in .env)

- `ANTHROPIC_API_KEY` — Claude API key for OpenClaw
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (optional, for Telegram gateway)

## Docker Architecture

- **Stage 1 (deps)**: Installs `openclaw` and `mcporter` globally via npm, plus MCP server deps.
- **Stage 2 (runtime)**: Copies node_modules from deps, creates symlinks for binaries, sets up non-root `limbo` user, exposes port 18789.
- **Entrypoint**: Creates `/data/{vault,db,config,memory,backups,logs}`, runs migrations, renders `openclaw.json` from template via `envsubst`, starts `openclaw gateway`.

### Docker Known Issues (RESOLVED)

These issues have been identified and fixed in the current Dockerfile. Do NOT waste turns rediscovering them:

1. **Symlink vs copy for openclaw binary**: The `openclaw` binary MUST be a symlink (`ln -s`) to `/usr/local/lib/node_modules/openclaw/openclaw.mjs`, NOT a `COPY`. A regular file copy breaks `./dist/entry.js` relative path resolution.
2. **git required in deps stage**: `node-llama-cpp` (openclaw transitive dep) needs `git` during `npm install`. The deps stage includes `apt-get install git`.
3. **File ownership**: `/app` is owned by the `limbo` user. The entrypoint writes `openclaw.json` there at runtime, so it must be writable.
4. **OpenClaw commands**: Use `openclaw gateway` to start the server. `openclaw serve` is NOT a valid command. Check `openclaw --help` for available commands.
5. **Config location**: OpenClaw config is rendered to `/app/openclaw.json` at runtime. It is NOT at `~/.openclaw/openclaw.json`.

## Paperclip API Reference

### Connection

**ALWAYS use `http://127.0.0.1:3100` as the base URL.** The `$PAPERCLIP_API_URL` env var may not resolve correctly. Do not waste turns debugging connectivity — if the first call fails, immediately use the hardcoded URL.

### Authentication

Include `Authorization: Bearer $PAPERCLIP_API_KEY` on all requests. Include `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on all mutating requests (POST, PATCH, DELETE).

### Key Environment Variables

- `PAPERCLIP_API_KEY` — auth token
- `PAPERCLIP_API_URL` — may be unreliable, use `http://127.0.0.1:3100` instead
- `PAPERCLIP_AGENT_ID` — your agent ID
- `PAPERCLIP_COMPANY_ID` — company ID
- `PAPERCLIP_RUN_ID` — current run ID
- `PAPERCLIP_TASK_ID` — assigned task ID (if wake reason is task)
- `PAPERCLIP_WAKE_REASON` — why you were woken (issue_assigned, heartbeat, mention, etc.)

### Common Endpoints

```
GET  /api/agents/me                                    — your identity
GET  /api/companies/{companyId}/issues?assigneeAgentId={id}&status=todo,in_progress  — your tasks
POST /api/issues/{id}/checkout                         — lock a task (409 = already locked)
POST /api/issues/{id}/release                          — release a task lock
POST /api/issues/{id}/comments                         — add a comment
PATCH /api/issues/{id}                                 — update status
POST /api/companies/{companyId}/issues                 — create a new issue
```

### Checkout Rules (CRITICAL)

- Attempt checkout ONCE per task per run.
- On **409**: the task is locked by another run. Do NOT:
  - Retry with different headers or payloads
  - Try release + re-checkout
  - Re-assign yourself then retry
  - Read the issue to inspect `executionRunId`
- On 409: **immediately move to your next assigned task.**
- If ALL tasks are locked, comment on the most important one and exit cleanly.

## Git Review Workflow (CRITICAL)

Repo-changing LIM tasks must be isolated and reviewable by default.

- Use `staging` as the default PR base branch for this repo unless the task explicitly names a different non-`main` base.
- Never open a PR into `main`.
- Do repo work from a task-specific branch in a dedicated git worktree, not from the shared root checkout and not from another agent's branch.
- Recommended pattern:

```bash
git fetch origin
git worktree add .worktrees/<task-slug> -b <agent>/<task-slug> origin/staging
cd .worktrees/<task-slug>
```

- Keep one task per branch/worktree. Do not mix unrelated changes.
- Before marking work ready, push the branch and open a PR targeting `staging`.
- If `staging` does not exist locally, fetch it from `origin`. If `origin/staging` is missing entirely, raise a Paperclip blocker instead of improvising a base branch.

## Budget and Rate Limits

- Before starting work, check if you can actually complete it.
- If a rate limit error occurs (429 or "hit your limit"), **exit immediately** with a comment explaining what was in progress. Do NOT retry.
- Target: complete meaningful work in **under 40 turns**. If past 60 turns, wrap up and commit what you have.
- If stuck in a loop (same error 3+ times), stop, comment the blocker, and exit.
