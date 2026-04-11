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

**Runner topology:** all jobs run on a self-hosted GitLab runner (tag `self-hosted`). The project does not consume GitLab SaaS minutes. The release job used to run on SaaS because of OIDC trusted publishing, but npm does not yet accept id_tokens from self-hosted runners, so release was moved to self-hosted with a classic `NPM_TOKEN` instead (trade-off: no provenance attestation).

| Stage | Jobs | Trigger | Runner |
|-------|------|---------|--------|
| test | `docker-build`, `mcp-server-check`, `tests` | MRs + push to staging | self-hosted |
| promote | `promote-staging-to-main` | Push to staging | self-hosted |
| release | `release` (validate + docker build/push + npm publish + tag) | **Manual** — Run pipeline on `main` with `RELEASE=true` | self-hosted |

**Docker layer cache:** `docker-build` and `release` mount the host Docker socket (`/var/run/docker.sock`) instead of using `docker:dind`. This gives persistent layer cache across pipeline runs on the same runner — first cold build is ~5 min, subsequent builds are ~30-60s when only code changes.

**Required CI/CD variables** (set `hidden` + `masked`):

- `NPM_TOKEN` — npm granular automation token, scope: `limbo-ai` read+write. Used by the release job.
- `GITLAB_TOKEN` — GitLab PAT with `api` scope. Used by the promote job (create/update MR) and release job (push tag + create GitLab Release).

The release job:
- Is **read-only over git branches** — never commits or pushes to `main`, only pushes an annotated tag at the end.
- Is **idempotent** — checks `npm view` first; skips publish if the version is already on npm.
- Fails fast with actionable errors if `NPM_TOKEN` or `GITLAB_TOKEN` is missing.

**Local hooks (see CONTRIBUTING.md):** husky pre-commit runs lint-staged + gitleaks. Pre-push runs `npm test`. Both source nvm so they always use the pinned Node version from `.nvmrc`.

## Versioning & Release Workflow

Limbo uses **Calendar Versioning** (CalVer) in the format `YYYY.M.N`:
- `YYYY` — year (4 digits)
- `M` — month (1-12, no leading zero)
- `N` — release counter within the month, resets to 0 each month

Version is managed locally by [`release-it`](https://github.com/release-it/release-it) with the [`@csmith/release-it-calver-plugin`](https://github.com/casmith/release-it-calver-plugin) and [`@release-it/conventional-changelog`](https://github.com/release-it/conventional-changelog) plugins. Config lives in `.release-it.json`.

### Dev workflow (normal features)

- Branch from `staging` with conventional commit messages: `feat:`, `fix:`, `feat!:` (breaking), etc.
- Open MR against `staging`, merge. Auto-promote MR to `main` gets created/updated by the `promote-staging-to-main` job.
- **Do NOT touch `package.json` or `CHANGELOG.md` in feature MRs.** They're managed by `release-it`.

### Release workflow (when ready to publish)

**1. Bump version and generate changelog locally:**
```bash
git checkout staging && git pull gitlab staging
npx release-it
```

`release-it` will:
- Ask you to confirm the next version (e.g. `2026.4.0 → 2026.5.0`)
- Parse conventional commits since the last tag
- Bump `package.json` to the new CalVer version
- Update `CHANGELOG.md` with the new entries
- Commit `chore: release v<version>` locally

It does **NOT** tag, push, or publish — all those are handled by CI.

**2. Push the release commit to staging:**
```bash
git push gitlab staging
```

This triggers the staging pipeline and updates the auto-promote MR to main.

**3. Merge the promote MR** (staging → main) as usual.

**4. Trigger the release pipeline manually:**
- Go to **GitLab UI → CI/CD → Pipelines → Run pipeline**
- Branch: `main`
- Add variable: `RELEASE = true`
- Click **Run pipeline**

The release job will:
- Read the version from `package.json`
- Validate CalVer format
- Skip if the version is already on npm (idempotency check)
- Build and push Docker images (`:VERSION`, `:MINOR`, `:MAJOR`, `:latest`)
- Publish to npm via `NPM_TOKEN` (classic auth — no provenance until npm supports self-hosted runners)
- Create annotated git tag `v<version>` and push it
- Create the GitLab Release with changelog

### Safety properties

- **Dev-proof**: the bump is the trigger for everything. Forgetting to bump means nothing gets published (idempotency check catches it).
- **No automatic publishing on merge**: merging staging→main does NOT publish. You have to explicitly run the pipeline with `RELEASE=true`.
- **Rollback trivial**: if you merged the bump but don't want to publish, just don't run the release pipeline.
- **Re-runnable**: if a release job fails mid-way, re-running it is idempotent — already-published steps (npm, docker tags) are detected and skipped.
- **No CI writes to main**: the release job never commits or pushes to `main`, only pushes the tag. Branch protection on `main` stays strict.

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

After the secrets-consolidation work, the e2e `.env` lives at `/tmp/limbo-e2e-test/config/.env` (new path), not `/tmp/limbo-e2e-test/.env`. If you have an older e2e state, move it: `mkdir -p /tmp/limbo-e2e-test/config && mv /tmp/limbo-e2e-test/.env /tmp/limbo-e2e-test/config/.env`. Legacy secret files are migrated into `.env` automatically by the container on boot.

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
