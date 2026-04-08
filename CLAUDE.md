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
| Config template | `config.toml.template` |
| Docker build | `Dockerfile` (3-stage: deps → zeroclaw → runtime) |
| Unit tests | `test/*.test.js` (node --test) |
| Setup wizard | `setup-server/server.js` (zero deps) |

## Common Tasks

- **Adding a new MCP tool**: Create `mcp-server/tools/<name>.js`, register in `mcp-server/index.js`
- **Changing agent behavior**: Edit `workspace/system/AGENTS.md` (resets on container boot)
- **Adding a feature toggle**: Follow pattern: wizard toggle → secret → env var → entrypoint TOML append
- **Running evals**: `docker build -t limbo:eval . && LIMBO_IMAGE=limbo:eval docker compose -f evals/docker-compose.eval.yml up -d && node evals/cli.js run`
- **Bumping ZeroClaw**: `./scripts/build-zeroclaw.sh <version>` THEN update `ZEROCLAW_IMAGE` ARG in Dockerfile

## Git Workflow

- **Remote: `gitlab`** — GitHub account is suspended (appeal pending, Ticket #4254416). Push to `gitlab`, not `origin`.
- **Integration branch: `staging`** — ALL merge requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Use `git push gitlab <branch>` for all pushes
- Create MRs via GitLab API or web UI (not `gh pr create` — GitHub is down)
- **When GitHub is restored**: resume `git push origin`, optionally remove `gitlab` remote

## Container Registry (MIGRATED)

> **Status: GitLab registry active, ghcr.io inaccessible (GitHub suspended)**

All container images now live on **GitLab Container Registry**, not ghcr.io:
- Limbo image: `registry.gitlab.com/tomas209/limbo`
- ZeroClaw image: `registry.gitlab.com/tomas209/zeroclaw`

**When GitHub is restored**: evaluate whether to move back to ghcr.io or stay on GitLab.

## Custom ZeroClaw Build

Limbo uses a custom ZeroClaw image with extra cargo features (`rag-pdf`).
The image tag follows the pattern `registry.gitlab.com/tomas209/zeroclaw:<version>-custom`.

**Rebuild ZeroClaw** (only when changing features or version):
```bash
./scripts/build-zeroclaw.sh              # default version + rag-pdf
./scripts/build-zeroclaw.sh v0.6.3       # upgrade version
./scripts/build-zeroclaw.sh v0.5.3 "rag-pdf,browser-native"  # add features
```

The script builds multi-platform (amd64+arm64) and pushes to GitLab Container Registry. Requires `docker login registry.gitlab.com`.

**Critical rules when bumping ZeroClaw:**
- The Dockerfile MUST use the custom image (`registry.gitlab.com/tomas209/zeroclaw:<version>-custom`), never the official one — we need `rag-pdf`.
- Always build and push the custom image BEFORE pushing the Dockerfile change — CI pulls from the registry.
- The image must include both `linux/amd64` and `linux/arm64` — CI runs on amd64, local dev is arm64.
- When a new ZeroClaw version adds workspace members, the build script may need patching (see Patch 3 in the script).

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

```bash
docker build -t limbo:rag-pdf-test .                         # build limbo image
docker compose -f docker-compose.test.yml up -d              # start (first time opens setup wizard at :18789)
docker compose -f docker-compose.test.yml logs -f            # tail logs
docker compose -f docker-compose.test.yml down               # stop (keeps config)
docker compose -f docker-compose.test.yml down -v            # full reset (wipes setup)
```

Config and secrets persist in named volumes (`limbo-test-data`, `limbo-test-state`).
Only the first run requires Telegram/provider setup — subsequent starts are instant.

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
