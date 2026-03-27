# Limbo — Project Instructions

## Git Workflow

- **Integration branch: `staging`** — ALL pull requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Always use `--base staging` when creating PRs with `gh pr create`

## Custom ZeroClaw Build

Limbo uses a custom ZeroClaw image with extra cargo features (`rag-pdf`).
The image tag follows the pattern `ghcr.io/tomasward1/zeroclaw:<version>-custom`.

**Rebuild ZeroClaw** (only when changing features or version):
```bash
./scripts/build-zeroclaw.sh              # default version + rag-pdf
./scripts/build-zeroclaw.sh v0.6.3       # upgrade version
./scripts/build-zeroclaw.sh v0.5.3 "rag-pdf,browser-native"  # add features
```

The script builds multi-platform (amd64+arm64) and pushes to GHCR automatically. Requires `docker login ghcr.io`.

**Critical rules when bumping ZeroClaw:**
- The Dockerfile MUST use the custom image (`ghcr.io/tomasward1/zeroclaw:<version>-custom`), never the official one — we need `rag-pdf`.
- Always build and push the custom image BEFORE pushing the Dockerfile change — CI pulls from GHCR.
- The image must include both `linux/amd64` and `linux/arm64` — CI runs on amd64, local dev is arm64.
- When a new ZeroClaw version adds workspace members, the build script may need patching (see Patch 3 in the script).

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
