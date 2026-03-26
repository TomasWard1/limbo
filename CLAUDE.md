# Limbo — Project Instructions

## Git Workflow

- **Integration branch: `staging`** — ALL pull requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Always use `--base staging` when creating PRs with `gh pr create`

## Dev Secrets

Shared dev secrets live in `~/.limbo-dev/secrets/` (LLM API key, gateway token, Telegram bot token). These are the same across all local Limbo instances — dev, eval, test. All docker-compose files for local development should reference secrets from this path.

```yaml
secrets:
  llm_api_key:
    file: ~/.limbo-dev/secrets/llm_api_key
```

Never commit secrets. Never create new ones per instance — always reuse the shared set.

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
