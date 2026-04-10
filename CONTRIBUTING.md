# Contributing to Limbo

## Getting started

### Prerequisites

- **Node.js 22** — pinned via `.nvmrc`. If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm use` in the repo root and it will pick it up. The project is known to hit a test pollution bug on Node ≥ 25; please do not develop against newer Node versions.
- **Docker** — required for local image builds and to run the test/prod stacks.
- **[gitleaks](https://github.com/gitleaks/gitleaks)** (optional but recommended) — the pre-commit hook uses it to scan staged changes for accidentally committed secrets. `brew install gitleaks` or equivalent. The hook no-ops with a warning if it's missing.

### First-time setup

```bash
git clone https://gitlab.com/tomas209/limbo.git
cd limbo
nvm use                    # if you use nvm, otherwise make sure node -v starts with v22
npm install                # installs deps AND activates husky git hooks
```

`npm install` runs `husky` as a `prepare` script, which installs the hooks from `.husky/` into your local `.git/hooks/`. You don't need to run anything else — the next time you commit or push, the hooks will fire automatically.

## Git hooks (pre-commit & pre-push)

Every checkout runs the same hooks. They are **deterministic** — they don't rely on you remembering to run anything. If a hook fails, the commit/push is aborted.

### pre-commit (~500ms)

Runs on every `git commit` against **staged files only**.

- **`lint-staged` → `node --check`** — parse-only syntax check on staged `*.js` files. Catches typos and broken imports before they become a commit.
- **`gitleaks protect --staged`** — scans staged diffs for secret patterns (API keys, tokens, private keys). If gitleaks isn't installed on the host, the step is skipped with a warning.

### pre-push (~10s)

Runs on every `git push`.

- **`npm test`** — the full unit test suite (314 tests, `node --test`). Blocks the push on any failure.

The idea is simple: if a change breaks the test suite, we find out locally in 10 seconds instead of burning runner minutes and waiting for CI feedback. The CI pipeline is a safety net, not the first line of defense.

### Both hooks auto-source nvm

`.husky/pre-commit` and `.husky/pre-push` explicitly source `nvm` and activate the version from `.nvmrc` before running their checks. This means the hooks use Node 22 regardless of which Node is first in your shell `$PATH` when you run `git commit` or `git push`. Local and CI use the same Node version, always.

### Bypassing hooks

Don't. If a hook is blocking you for a legitimate reason (e.g. committing a WIP file for backup), push to a personal scratch branch without `--no-verify` and rebase cleanly before opening an MR. If a hook has a false positive, fix the hook — don't bypass it.

## Branch strategy

- `main` — production. Only receives merges from `staging`, never direct commits.
- `staging` — integration branch. All feature branches target `staging`.
- `feat/*`, `fix/*`, `chore/*` — feature branches, branched from `staging`.
- **Never open MRs directly into `main`.** The `promote-staging-to-main` CI job maintains an auto-updated MR from `staging` to `main` — that's the only way `main` advances.

Use [conventional commit](https://www.conventionalcommits.org/) messages on `staging`: `feat:`, `fix:`, `feat!:` for breaking, `chore:`, `docs:`. The auto-promote job infers the bump type from these.

## Release process

See `CLAUDE.md` § "Versioning & Release Workflow" for the full release procedure. Short version:

1. Bump version locally with `npx release-it` (runs on `staging`)
2. Push the release commit to `staging`
3. Merge the auto-promoted MR into `main`
4. Manually trigger the release pipeline from the GitLab UI with `RELEASE=true`

Releases publish to the npm package `limbo-ai` and to the GitLab Container Registry at `registry.gitlab.com/tomas209/limbo`.

## Reporting issues

Open issues at https://gitlab.com/tomas209/limbo/-/issues. For security issues, see `SECURITY.md`.
