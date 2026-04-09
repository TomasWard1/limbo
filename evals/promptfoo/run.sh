#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$EVALS_DIR")"

IMAGE="limbo:eval"
COMPOSE_FILE="$EVALS_DIR/docker-compose.eval.yml"
CONFIG_FILE="$SCRIPT_DIR/promptfooconfig.yaml"

# Build fresh image from current code
echo "==> Building image from current code..."
docker build -t "$IMAGE" "$PROJECT_ROOT"

# Start container (recreate to pick up new image)
echo "==> Starting eval container..."
LIMBO_IMAGE="$IMAGE" docker compose -f "$COMPOSE_FILE" up -d --force-recreate --wait

# Run evals (pass through any extra args like --filter-pattern, --no-cache)
echo "==> Running evals..."
cd "$SCRIPT_DIR"
npx promptfoo eval -c "$CONFIG_FILE" "$@"

echo "==> Done. Run 'npx promptfoo view' to see results."
