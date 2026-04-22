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
| Container startup | `scripts/entrypoint.sh` (sources `.env`, runs regen script, execs supervisor) |
| Container main process | `scripts/supervisor.js` → `lib/supervisor.js` (wires OpenClaw + control plane) |
| OpenClaw config regen | `scripts/regen-openclaw-config.sh` (single source of truth) |
| Control plane (TCP API) | `lib/control-server.js` + `lib/control-router.js` + `lib/control-client.js` |
| Wizard spawner | `lib/wizard-spawner.js` (forks setup-server on LIMBO_PORT+1) |
| Session store | `lib/session-store.js` (state machine with terminal-wins) |
| Agent persona | `workspace/system/` (reset on boot) + `workspace/templates/` (persist) |
| CLI | `cli.js` (single ~90KB file) |
| Eval config | `evals/promptfoo/promptfooconfig.yaml` |
| Eval runner | `evals/promptfoo/run.sh` (wraps `npx promptfoo eval`) |
| Config template | `openclaw.json.template` |
| Docker build | `Dockerfile` (2-stage: deps → runtime) |
| Unit tests | `test/*.test.js` (node --test) — see `package.json` for authoritative list |
| Setup wizard | `setup-server/server.js` (zero deps) |
| Public server | `lib/public-server.js` (HTTP proxy to wizard when active, static page when idle) |
| Cloud Workers | `workers/provisioning/worker.js` + `workers/auth-relay/worker.js` |

## Port Layout

Every Limbo instance publishes ports on the host:

| Port | What | Lifetime | Binding |
|------|------|----------|---------|
| `LIMBO_PORT` (default 18789) | OpenClaw gateway | Always on | `127.0.0.1` (loopback) |
| `LIMBO_PORT+1` | On-demand wizard | Only during a wizard | `127.0.0.1` (loopback) |
| `LIMBO_PORT+2` | Supervisor control plane | Always on | `127.0.0.1` (loopback) |
| `80` | Public server (Limbo Cloud) | Always on when `LIMBO_PUBLIC_URL` set | `0.0.0.0` (internet-facing) |

Port 80 is only added when `LIMBO_PUBLIC_URL` is in the `.env` (cloud mode). Cloudflare proxy terminates TLS. The public server proxies to the wizard when active, serves a static page when idle. See ARCHITECTURE.md for full details.

## Common Tasks

- **Adding a new MCP tool**: Create `mcp-server/tools/<name>.js`, register in `mcp-server/index.js`
- **Changing agent behavior**: Edit `workspace/system/AGENTS.md` (resets on container boot)
- **Adding a feature toggle**: Follow pattern: wizard toggle → `.env` key → `regen-openclaw-config.sh` injects JSON config
- **Adding a new on-demand wizard (like connect-calendar)**: Add an entry to `DEFAULT_FEATURE_MODE_ENV` in `lib/wizard-spawner.js`, add a `handle<X>Mode` branch in `setup-server/server.js`, add a `cmd<X>()` in `cli.js` that mirrors `cmdConnectCalendar` (control-client + requestWizard + poll)
- **Running evals**: `docker build -t limbo:eval . && LIMBO_IMAGE=limbo:eval docker compose -f evals/docker-compose.eval.yml up -d && cd evals/promptfoo && npx promptfoo eval`
- **Bumping OpenClaw**: Update the `openclaw` version in `package.json`, then `npm install`
- **Debugging the control plane**: `curl http://127.0.0.1:18791/health` from the host. Expect `{"ok":true,"activeSessions":N}`. For a full wizard flow, `curl -XPOST -d '{"feature":"calendar","timeoutMs":900000}' http://127.0.0.1:18791/wizard`.

## Git Workflow

- **Primary remote: `origin`** → `github.com/TomasWard1/limbo`. All pushes and PRs go here.
- **Fallback remote: `gitlab`** → `gitlab.com/tomas209/limbo`. Kept intact but dormant. Only use if GitHub becomes unavailable again.
- **Integration branch: `staging`** — ALL PRs MUST target `staging`, never `main`.
- `main` is the production/release branch — only receives merges from `staging` via the auto-promote PR.
- Feature branches are created from `staging`.
- Use `git push origin <branch>` for all pushes. Create PRs via `gh pr create`.
- **Do not push to both remotes by default.** `gitlab` stays frozen unless we need to fall back.

## Container Registry

> **Status: GitHub migration in progress (2026-04-22).**

Transition phase to avoid prod breakage:

- **Phase A (now)**: `Release` workflow builds multi-arch and pushes to **both** `ghcr.io/tomasward1/limbo` (primary) and `registry.gitlab.com/tomas209/limbo` (legacy) when `ENABLE_GITLAB_DUAL_PUSH=true` is set as a repo variable. Prod installs keep pulling from GitLab unchanged.
- **Phase B**: once Phase A has shipped a release successfully, flip `DEFAULT_REGISTRY` in `cli.js`, `docker-compose.yml`, and `scripts/install.sh` to `ghcr.io/tomasward1/limbo`. Users get the new compose template on next `limbo update` via `regen-openclaw-config.sh` (see [[limbo-update-must-regenerate-compose-not-patch]]). Keep dual-push for 2–3 releases as a safety net.
- **Phase C**: drop the GitLab login + dual tags from `publish.yml`. `.gitlab-ci.yml` stays dormant.

Legacy image tags already pushed to GitLab (`2026.4.x`, `2026.5.x`, `latest`) stay available indefinitely — we are not deleting anything on GitLab.

## OpenClaw Runtime

Limbo uses OpenClaw (Node.js) as its agent runtime. OpenClaw is an npm dependency — no custom image builds needed.

**Bumping OpenClaw**: Update the version in `package.json` and run `npm install`. No multi-platform builds, no registry pushes — it's just a Node.js package.

## CI/CD

Limbo uses **GitHub Actions** (`.github/workflows/*.yml`). The `.gitlab-ci.yml` is kept dormant as a fallback.

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| CI | `ci.yml` | PRs to main/staging + push to staging | docker-build, mcp-server-check, unit tests |
| Promote | `promote.yml` | Push to staging | Auto-creates/updates a PR from `staging` → `main` with bump type in title |
| Release | `publish.yml` | Push to main | Auto-bumps version from conventional commits, builds multi-arch images, pushes to GHCR (+ GitLab when dual-push enabled), publishes to npm with OIDC provenance, tags + creates GitHub Release |
| Deploy install | `deploy-install.yml` | Push to main/staging touching `scripts/install.sh` | Deploys to Cloudflare Pages (`get.heylimbo.com`) |

**Release model is auto-bump on merge.** Unlike the legacy GitLab flow (manual `npx release-it` + `RELEASE=true`), the GitHub release workflow parses conventional commits on `main` and bumps the version automatically. **Do not pre-bump `package.json` locally anymore** — `publish.yml` does it in CI, commits the bump back to `main`, tags, and pushes.

If conventional commits since last tag yield no `feat:` / `fix:` / `feat!:`, the workflow exits clean without publishing.

**Required repo secrets:**

- `PAT_TOKEN` — GitHub PAT (`repo` scope) used by the release workflow to push the version-bump commit + tag back to `main` (the default `GITHUB_TOKEN` cannot trigger follow-up workflows or bypass branch protection on its own).
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — for `deploy-install.yml`.
- `GITLAB_REGISTRY_USER` + `GITLAB_REGISTRY_TOKEN` — optional. GitLab deploy token with `read_registry,write_registry` scope. Only used when `vars.ENABLE_GITLAB_DUAL_PUSH == 'true'`.

**Required repo variables:**

- `ENABLE_GITLAB_DUAL_PUSH` — set to `'true'` during the migration window to also push images to `registry.gitlab.com/tomas209/limbo`. Unset or any other value skips the GitLab login/push.

**npm OIDC trusted publishing:** `limbo-ai` must be configured on npmjs.com → Package settings → Trusted publishers → add GitHub publisher (`TomasWard1/limbo`, workflow `publish.yml`). This enables `npm publish --provenance` without `NPM_TOKEN`.

**Local hooks (see CONTRIBUTING.md):** husky pre-commit runs lint-staged + gitleaks. Pre-push runs `npm test`. Both source nvm so they always use the pinned Node version from `.nvmrc`.

### GitLab fallback (dormant)

`.gitlab-ci.yml` preserves the previous pipeline (self-hosted runner, manual release via `RELEASE=true`, classic `NPM_TOKEN`). To reactivate:
1. Push the branch to `gitlab` instead of `origin`.
2. Use the local `npx release-it` bump flow (see previous version of this doc in git history).
3. Trigger `RELEASE=true` manually from the GitLab UI.

Do not run both pipelines simultaneously — double-tag / double-publish.

## Versioning & Release Workflow

Limbo uses **Calendar Versioning** (CalVer) in the format `YYYY.M.N`:
- `YYYY` — year (4 digits)
- `M` — month (1-12, no leading zero)
- `N` — release counter within the month, resets to 0 each month

Version is auto-bumped by the GitHub `Release` workflow (`publish.yml`) on merge to `main`, based on conventional commit prefixes since the last tag. The `.release-it.json` config is kept only for the dormant GitLab fallback flow.

### Dev workflow (normal features)

- Branch from `staging` with conventional commit messages: `feat:`, `fix:`, `feat!:` (breaking), `chore:`, `docs:`.
- Open PR against `staging` via `gh pr create`. Merge when green.
- The `Promote staging to main` workflow maintains an auto-updated PR from `staging` → `main`.
- **Do NOT touch `package.json` or `CHANGELOG.md` in feature PRs.** The release workflow owns the bump.

### Release workflow

1. Merge the staging→main promote PR.
2. `publish.yml` fires on push to `main`. It:
   - Parses first-parent commits since the last tag; derives bump type (`feat!` → major, `feat` → minor, `fix` → patch, else no-op).
   - Exits cleanly if nothing releasable.
   - Runs `npm version <bump> --no-git-tag-version` in CI to compute the new version.
   - Builds multi-arch images (`linux/amd64,linux/arm64`) and pushes to `ghcr.io/tomasward1/limbo` with tags `:VERSION`, `:MINOR`, `:MAJOR`, `:latest`. When `ENABLE_GITLAB_DUAL_PUSH=true`, also pushes the same tags to `registry.gitlab.com/tomas209/limbo`.
   - Smoke-tests the published image (pulls amd64, runs with a dummy key, checks startup).
   - `npm publish --provenance --access public` (OIDC trusted publishing; no token needed — configure the trusted publisher on npmjs.com first).
   - Commits `chore: release v<version> [skip ci]`, tags, and pushes via `PAT_TOKEN`.
   - Creates a GitHub Release with changelog from commit log.

### Safety properties

- **Idempotent no-op**: no `feat`/`fix` commits since last tag → workflow exits without side effects.
- **`[skip ci]` on the release commit** prevents the version-bump push from re-triggering `publish.yml`.
- **OIDC trusted publishing** replaces long-lived `NPM_TOKEN`. Provenance is attested automatically.
- **Branch protection on `main`**: the release commit is pushed via `PAT_TOKEN` (GitHub PAT with `repo` scope); `GITHUB_TOKEN` alone would be blocked.
- **Rollback**: if a release goes out wrong, `gh release delete` + `npm unpublish` (within 72h) + `git push --delete origin v<version>`. The next conventional-commit PR to main will re-release.

## Dev Secrets

Shared dev secrets live in `~/.limbo-dev/secrets/` (LLM API key, gateway token, Telegram bot token). These are the same across all local Limbo instances — dev, eval, test. All docker-compose files for local development should reference secrets from this path.

```yaml
secrets:
  llm_api_key:
    file: ~/.limbo-dev/secrets/llm_api_key
```

Never commit secrets. Never create new ones per instance — always reuse the shared set.

## Local Development

**Use OrbStack, not Docker Desktop.** `brew install --cask orbstack`. Both work for normal containers, but OrbStack starts in ~2s and has cleaner port-forwarding behavior. (Neither proxies Unix domain sockets through bind mounts on macOS — which is WHY the control plane is TCP now. See ARCHITECTURE.md "Why TCP loopback, not a Unix domain socket".)

**E2E testing** uses a pre-configured environment at `/tmp/limbo-e2e-test/` with Telegram bot, secrets, and vault already set up. No wizard needed — just build and run:

```bash
docker build -t limbo:test .                                              # build image
LIMBO_IMAGE=limbo:test docker compose -f docker-compose.test.yml up -d    # start
docker compose -f docker-compose.test.yml logs -f                         # tail logs
docker compose -f docker-compose.test.yml down                            # stop
```

The container exposes three ports on the host loopback:
- `127.0.0.1:18900`  → OpenClaw gateway (`curl http://127.0.0.1:18900/healthz` should return `{"ok":true}`)
- `127.0.0.1:18901`  → wizard port (only live during connect-calendar / switch-brain)
- `127.0.0.1:18902`  → supervisor control plane (`curl http://127.0.0.1:18902/health` should return `{"ok":true,"activeSessions":0}`)

**Testing connect-calendar / switch-brain against the e2e container from your Mac:**

```bash
# Health check of the control plane
curl http://127.0.0.1:18902/health

# Fire a wizard request directly
curl -XPOST -H 'Content-Type: application/json' \
  -d '{"feature":"calendar","timeoutMs":900000}' \
  http://127.0.0.1:18902/wizard

# Or go through the CLI end-to-end (points the CLI at the e2e state):
LIMBO_HOME=/tmp/limbo-e2e-test node cli.js connect-calendar
LIMBO_HOME=/tmp/limbo-e2e-test node cli.js switch-brain
```

The e2e state lives in `/tmp/limbo-e2e-test/` (bind mounts for vault, openclaw-state, config, flags). Data volume is `limbo-e2e-test_limbo-data`.

**Migrating older e2e state:** after the secrets-consolidation work, the e2e `.env` lives at `/tmp/limbo-e2e-test/config/.env` (new path). If you have an older e2e state at `/tmp/limbo-e2e-test/.env`, move it: `mkdir -p /tmp/limbo-e2e-test/config && mv /tmp/limbo-e2e-test/.env /tmp/limbo-e2e-test/config/.env`. Legacy secret files are migrated into `.env` automatically by the host CLI (not the container).

**Google OAuth redirect URI after wizard-sidecar:** the connect-calendar wizard now runs on `LIMBO_PORT+1` (18901 for e2e, 18790 for default local installs). Existing users had their Google Cloud Console OAuth client pointed at `http://localhost:<LIMBO_PORT>/auth/google/callback` (the old wizard-on-main-port flow). That URI no longer matches. Add `http://localhost:<LIMBO_PORT+1>/auth/google/callback` to the "Authorized redirect URIs" list of the relevant OAuth 2.0 Client ID at <https://console.cloud.google.com/apis/credentials>.

## Evals

`limbo-eval` tests Limbo end-to-end using **promptfoo**. Tests send real messages to a Docker container and assert tool calls, vault state, and response content.

```bash
# Build image from current branch
docker build -t limbo:eval .

# Start eval container
LIMBO_IMAGE=limbo:eval docker compose -f evals/docker-compose.eval.yml up -d

# Run evals
cd evals/promptfoo && npx promptfoo eval

# View results in browser
npx promptfoo view
```

**Or use the wrapper script** (builds + starts container + runs evals):
```bash
./evals/promptfoo/run.sh
```

**Key files:**
- `evals/promptfoo/promptfooconfig.yaml` — test definitions (prompts + assertions)
- `evals/promptfoo/provider.js` — sends messages to the container, parses MCP logs
- `evals/promptfoo/assertions.js` — custom assertion functions (toolCalled, paramMatch, cronCountIncreased, etc.)
- `evals/promptfoo/hooks.js` — beforeAll/afterEach lifecycle (resets vault, seeds notes, clears crons)
- `evals/promptfoo/seeds/` — additional seed notes for tests

**Adding a new eval test:** add a test block to `promptfooconfig.yaml`. Use `__sessionGroup` for multi-turn flows. Available custom assertions: `toolCalled`, `paramMatch`, `responseMatches`, `userProfileMatches`, `cronCreated`, `cronCountIncreased`, `vaultNoteCreated`.

Evals use real LLM calls (cost tokens). The MCP server logs tool calls to `/data/logs/mcp.log` when `LIMBO_EVAL=true`.

**Prerequisites:**
- `~/.limbo-dev/secrets/auth-profiles.json` — Codex OAuth credentials (copy from a working Limbo instance's `agents/main/agent/auth-profiles.json`). The entrypoint seeds this into the eval container automatically.
- `~/.limbo-dev/eval-tokens.env` — env file with `LLM_API_KEY`, `GATEWAY_TOKEN`, `TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `BRAVE_API_KEY` (create from `~/.limbo-dev/secrets/*`).

**Gotchas:**
- **`-u limbo` on all `docker exec`**: The container runs as user `limbo` (uid 999) via gosu. All `docker exec` calls in hooks.js and provider.js MUST use `-u limbo`, otherwise files get created as root and the MCP server can't write logs → `toolCalled` assertions fail silently.
- **`--filter-pattern` breaks multi-turn flows**: Filtering only runs matching tests, so turn2 of a `__sessionGroup` flow won't have context from turn1. Always run the full suite, or filter by a pattern that captures both turns.
- **Mock gws must echo input**: The mock `gws` binary in `evals/fixtures/gws/` must reflect the agent's input back (title, startTime) in create/update responses. Static fixtures cause the agent to detect inconsistencies and refuse to confirm.
- **Single-turn vs multi-turn**: The agent sometimes completes an action in one turn without asking confirmation. Design tests accordingly: use "No me pidas confirmación, hacelo directo" for single-turn tests, use `__sessionGroup` for flows where confirmation is mandatory (like delete).
