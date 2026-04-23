#!/bin/bash
# Sonnet-via-LiteLLM variant of run.sh. Builds the image, bootstraps
# postgres + litellm side-cars, starts the limbo-eval-sonnet container,
# then hands off to promptfoo.
#
# Required: ANTHROPIC_API_KEY in the environment (fetch from 1Password
# item limbo/anthropic-api-testing, UUID zr5ul32zh2qcg7yqkddhxlhcgy).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$EVALS_DIR")"

IMAGE="limbo:eval"
COMPOSE_FILE="$EVALS_DIR/docker-compose.eval-sonnet.yml"
CONFIG_FILE="$SCRIPT_DIR/promptfooconfig.yaml"

: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY before running (op item get zr5ul32zh2qcg7yqkddhxlhcgy --reveal ...)}"

echo "==> Building image from current code..."
docker build -t "$IMAGE" "$PROJECT_ROOT"

echo "==> Bootstrapping LiteLLM side-car + virtual key..."
bash "$EVALS_DIR/scripts/bootstrap-eval-sonnet.sh"

echo "==> Starting limbo-eval-sonnet container..."
LIMBO_IMAGE="$IMAGE" docker compose -f "$COMPOSE_FILE" up -d --force-recreate --wait limbo-eval-sonnet

# hooks.js defaults to container name `limbo-eval`; point it at the sonnet one.
export LIMBO_EVAL_CONTAINER="limbo-eval-sonnet"

echo "==> Running evals against Sonnet via LiteLLM..."
cd "$SCRIPT_DIR"
npx promptfoo eval -c "$CONFIG_FILE" "$@"

echo "==> Done. Run 'npx promptfoo view' to see results."
