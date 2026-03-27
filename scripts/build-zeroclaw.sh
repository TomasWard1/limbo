#!/usr/bin/env bash
# Build a custom ZeroClaw image with additional cargo features.
# Usage:
#   ./scripts/build-zeroclaw.sh                          # defaults
#   ./scripts/build-zeroclaw.sh v0.6.3                   # custom version
#   ./scripts/build-zeroclaw.sh v0.5.3 "rag-pdf,browser-native"  # custom features
set -euo pipefail

ZEROCLAW_VERSION="${1:-v0.5.3}"
EXTRA_FEATURES="${2:-rag-pdf}"
BASE_FEATURES="channel-lark,whatsapp-web"
FEATURES="${BASE_FEATURES},${EXTRA_FEATURES}"
TAG="ghcr.io/tomasward1/zeroclaw:${ZEROCLAW_VERSION}-custom"

echo "==> Cloning ZeroClaw ${ZEROCLAW_VERSION}..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
git clone --branch "$ZEROCLAW_VERSION" --depth 1 \
  https://github.com/zeroclaw-labs/zeroclaw.git "$TMPDIR"

# Patch 1: remove --locked flag so extra features can update Cargo.lock.
# Known issue (zeroclaw-labs/zeroclaw#2062) fixed in later versions.
sed -i.bak 's/cargo build --release --locked/cargo build --release/g' "$TMPDIR/Dockerfile"

# Patch 2: use Bookworm-based Rust image so the binary links against glibc 2.36,
# matching Limbo's node:22-slim (Bookworm) runtime.
sed -i.bak 's|FROM rust:1.94-slim@sha256:[a-f0-9]*|FROM rust:1.94-slim-bookworm|g' "$TMPDIR/Dockerfile"

echo "==> Building with features: ${FEATURES}"
docker build \
  --build-arg ZEROCLAW_CARGO_FEATURES="$FEATURES" \
  --target release \
  -t "$TAG" \
  "$TMPDIR"

echo ""
echo "==> Done: $TAG"
echo "    Update your Dockerfile:"
echo "    FROM $TAG AS zeroclaw"
