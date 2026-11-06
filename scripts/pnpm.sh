#!/bin/sh
# Runs pnpm inside the dev container (the package store lives at /repo/.pnpm-store there), e.g.
#   ./scripts/pnpm.sh --filter @somnium/engine add some-package
#   ./scripts/pnpm.sh -r test
cd "$(dirname "$0")/.." && exec docker compose -f docker-compose.dev.yml run --rm --no-deps -T install corepack pnpm "$@"
