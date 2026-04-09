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
└── docs/                         # Business docs (market research, GTM, etc.)
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

- `ANTHROPIC_API_KEY` — Claude API key
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (optional, for Telegram gateway)

## Docker Architecture

- **Stage 1 (deps)**: Installs MCP server Node.js dependencies.
- **Stage 2 (runtime)**: Installs OpenClaw as npm dependency, copies MCP server node_modules, sets up non-root `limbo` user, exposes port 18789.
- **Entrypoint**: Creates `/data/{vault,db,config,memory,backups,logs}`, runs migrations, renders `openclaw.json` from template via `envsubst`, starts `openclaw gateway`.

### Docker Known Issues (RESOLVED)

These issues have been identified and fixed in the current Dockerfile. Do NOT waste turns rediscovering them:

1. **OpenClaw is an npm package**: Installed via `npm install` in the Dockerfile. No binary copy needed.
2. **Config is JSON, not TOML**: `openclaw.json.template` is rendered via `envsubst` at runtime to `~/.openclaw/openclaw.json`.
3. **MCP is native**: OpenClaw spawns the MCP server directly from the JSON config `mcp` section. No mcporter needed.

## Git Review Workflow

Repo-changing tasks must be isolated and reviewable by default.

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
- If `staging` does not exist locally, fetch it from `origin`. If `origin/staging` is missing entirely, raise a blocker instead of improvising a base branch.
