#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVALS_DIR="$ROOT_DIR/evals"
EXPECTED_IMAGE="${LIMBO_IMAGE:-limbo:staging}"

cd "$EVALS_DIR"

echo "Recreating limbo-eval with image: $EXPECTED_IMAGE"
LIMBO_IMAGE="$EXPECTED_IMAGE" docker compose -f docker-compose.eval.yml up -d --force-recreate

ACTUAL_IMAGE="$(docker inspect limbo-eval --format '{{.Config.Image}}')"
if [[ "$ACTUAL_IMAGE" != "$EXPECTED_IMAGE" ]]; then
  echo "Expected limbo-eval image '$EXPECTED_IMAGE' but found '$ACTUAL_IMAGE'" >&2
  exit 1
fi

docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | rg '^limbo-eval'
echo "limbo-eval is running with the expected image."
