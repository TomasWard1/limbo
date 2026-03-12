# Contributing to Limbo

## Release Process (GHCR)

Stable deploys use pinned semver image tags via `LIMBO_IMAGE_TAG`.

- Release workflow: `.github/workflows/release-ghcr.yml`
- Published tags per release `vX.Y.Z`:
  - `ghcr.io/tomasward1/limbo:X.Y.Z`
  - `ghcr.io/tomasward1/limbo:X`
  - `ghcr.io/tomasward1/limbo:latest`

### Creating a release

```sh
git tag -a v1.0.0 -m "Limbo v1.0.0"
git push origin v1.0.0
```

### Verifying a public pull

```sh
docker logout ghcr.io
docker manifest inspect ghcr.io/tomasward1/limbo:1.0.0
docker pull ghcr.io/tomasward1/limbo:1.0.0
```

If GHCR pull is denied (private package or temporary registry policy), the installer falls back to building from source on the target host.

## Branch Strategy

- `main` — production
- `staging` — integration branch for PRs
- Never open PRs directly into `main`
