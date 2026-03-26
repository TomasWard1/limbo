# Limbo — Project Instructions

## Git Workflow

- **Integration branch: `staging`** — ALL pull requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Always use `--base staging` when creating PRs with `gh pr create`

## Custom ZeroClaw Build

Limbo uses a custom ZeroClaw image with extra cargo features (`rag-pdf`).
The image lives at `ghcr.io/tomasward1/zeroclaw:v0.5.3-custom`.

**Rebuild ZeroClaw** (only when changing features or version):
```bash
./scripts/build-zeroclaw.sh              # default: v0.5.3 + rag-pdf
./scripts/build-zeroclaw.sh v0.6.3       # upgrade version
./scripts/build-zeroclaw.sh v0.5.3 "rag-pdf,browser-native"  # add features
```
Builds multi-platform (amd64+arm64) and pushes to GHCR. Requires `docker login ghcr.io`.

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
