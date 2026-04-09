# Limbo — Project Instructions

## Architecture

**Read `ARCHITECTURE.md` before exploring the codebase.** It has the full directory structure, component map, Docker build stages, MCP tool list, entrypoint flow, and key architectural decisions. This avoids redundant codebase scanning every session.

## Quick Navigation

| What | Where |
|------|-------|
| MCP tools | `mcp-server/tools/*.js` (one file per tool) |
| MCP entry point | `mcp-server/index.js` |
| FTS/search logic | `mcp-server/fts.js` |
| Vault index | `mcp-server/vault-index.js` |
| Container startup | `scripts/entrypoint.sh` (12-stage orchestration) |
| Agent persona | `workspace/system/` (reset on boot) + `workspace/templates/` (persist) |
| CLI | `cli.js` (single 84KB file) |
| Eval cases | `evals/cases/*.json` |
| Eval runner | `evals/cli.js` |
| Config template | `openclaw.json.template` |
| Docker build | `Dockerfile` (2-stage: deps → runtime) |
| Unit tests | `test/*.test.js` (node --test) |
| Setup wizard | `setup-server/server.js` (zero deps) |

## Common Tasks

- **Adding a new MCP tool**: Create `mcp-server/tools/<name>.js`, register in `mcp-server/index.js`
- **Changing agent behavior**: Edit `workspace/system/AGENTS.md` (resets on container boot)
- **Adding a feature toggle**: Follow pattern: wizard toggle → secret → env var → entrypoint JSON config
- **Running evals**: `docker build -t limbo:eval . && LIMBO_IMAGE=limbo:eval docker compose -f evals/docker-compose.eval.yml up -d && node evals/cli.js run`
- **Bumping OpenClaw**: Update the `openclaw` version in `package.json`, then `npm install`

## Git Workflow

- **Remote: `gitlab`** — GitHub account is suspended (appeal pending, Ticket #4254416). Push to `gitlab`, not `origin`.
- **Integration branch: `staging`** — ALL merge requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Use `git push gitlab <branch>` for all pushes
- Create MRs via `glab mr create` CLI (not `gh pr create` — GitHub is down)
- **When GitHub is restored**: resume `git push origin`, optionally remove `gitlab` remote

## Container Registry (MIGRATED)

> **Status: GitLab registry active, ghcr.io inaccessible (GitHub suspended)**

Limbo container image lives on **GitLab Container Registry**, not ghcr.io:
- Limbo image: `registry.gitlab.com/tomas209/limbo`

**When GitHub is restored**: evaluate whether to move back to ghcr.io or stay on GitLab.

## OpenClaw Runtime

Limbo uses OpenClaw (Node.js) as its agent runtime. OpenClaw is an npm dependency — no custom image builds needed.

**Bumping OpenClaw**: Update the version in `package.json` and run `npm install`. No multi-platform builds, no registry pushes — it's just a Node.js package.

## CI/CD

Limbo uses **GitLab CI** (`.gitlab-ci.yml`). GitHub Actions files are kept but inactive.

| Stage | Jobs | Trigger |
|-------|------|---------|
| test | `docker-build`, `mcp-server-check`, `tests` | MRs + push to staging |
| promote | `promote-staging-to-main` | Push to staging |
| release | `release` (version bump + npm publish + docker push + tag) | Push to main |

- npm publishing uses **OIDC trusted publishing** (no token needed)
- `GITLAB_TOKEN` CI variable is set for MR creation and release pushing
- Release job pushes version bump commit + tag to `main` (protected, maintainer push allowed)

## Dev Secrets

Shared dev secrets live in `~/.limbo-dev/secrets/` (LLM API key, gateway token, Telegram bot token). These are the same across all local Limbo instances — dev, eval, test. All docker-compose files for local development should reference secrets from this path.

```yaml
secrets:
  llm_api_key:
    file: ~/.limbo-dev/secrets/llm_api_key
```

Never commit secrets. Never create new ones per instance — always reuse the shared set.

## Local Development

**E2E testing** uses a pre-configured environment at `/tmp/limbo-e2e-test/` with Telegram bot, secrets, and vault already set up. No wizard needed — just build and run:

```bash
docker build -t limbo:test .                                              # build image
LIMBO_IMAGE=limbo:test docker compose -f docker-compose.test.yml up -d    # start on :18900
docker compose -f docker-compose.test.yml logs -f                         # tail logs
docker compose -f docker-compose.test.yml down                            # stop
```

The e2e state lives in `/tmp/limbo-e2e-test/` (bind mounts for vault, openclaw-state, secrets, flags). Data volume is `limbo-e2e-test_limbo-data`.

## Evals

`limbo-eval` tests Limbo end-to-end by sending real messages and checking tool calls + vault state.

```bash
# Build image from current branch
docker build -t limbo:eval .

# Start eval container
LIMBO_IMAGE=limbo:eval docker compose -f evals/docker-compose.eval.yml up -d

# Run evals
node evals/cli.js run

# Compare against baseline
node evals/cli.js compare --strict

# Promote as new baseline after a good run
node evals/cli.js promote
```

Evals use real LLM calls (cost tokens). The MCP server logs tool calls to stderr when `LIMBO_EVAL=true`.
