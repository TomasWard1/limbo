# Branching Strategy

## Branch Hierarchy

```
main (production) ← staging (pre-prod) ← feat/* fix/* chore/* (feature branches)
```

## Rules

### `main`
- **Protected.** Direct pushes are blocked.
- Merges come exclusively from `staging` via PR.
- Every merge triggers a Docker image publish to GHCR.

### `staging`
- Pre-production integration branch.
- All feature branches target `staging` via PR.
- CI runs on every PR and push to this branch.

### Feature branches
- Branch from `staging` (never from `main`).
- Naming: `feat/`, `fix/`, `chore/` prefix.
- Example: `feat/vault-search-improvements`, `fix/gateway-timeout`, `chore/update-deps`

## Agent Workflow

1. Start work: branch off `staging`
   ```bash
   git fetch origin staging
   git checkout -b feat/your-feature origin/staging
   ```

2. Do the work, commit.

3. Open PR targeting `staging`. CI must pass before merge.

4. After staging is validated, a human or release manager opens a PR from `staging` → `main`.

## CI/CD

| Event | Workflow | What it does |
|-------|----------|--------------|
| PR to `staging` or `main` | `ci.yml` | Docker build + MCP server check |
| Push to `staging` | `ci.yml` | Same as above |
| Merge to `main` | `docker-publish.yml` | Build & push multi-arch image to GHCR |
| Tag `v*` | `docker-publish.yml` | Build & push with semver tags |

## Image Tags

Produced by `docker-publish.yml` on merge to `main`:
- `ghcr.io/tomasward1/limbo:main`
- `ghcr.io/tomasward1/limbo:sha-<short-sha>`

On semver tags (`v1.2.3`):
- `ghcr.io/tomasward1/limbo:1.2.3`
- `ghcr.io/tomasward1/limbo:1`
