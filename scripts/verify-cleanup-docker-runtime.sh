#!/usr/bin/env bash
# Builds the production Docker image and verifies the cleanup CLI inside the
# final runtime layer without mounting the source checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${CLEANUP_DOCKER_IMAGE:-upt-cleanup-runtime-test:local}"
HOST_DATABASE_URL="${HOST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/upt_portal_ci}"
export DATABASE_URL="$HOST_DATABASE_URL"

if [ -n "${CONTAINER_DATABASE_URL:-}" ]; then
  :
elif [ -n "${GITHUB_ACTIONS:-}" ]; then
  CONTAINER_DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upt_portal_ci"
else
  # Linux runners without a bridged host alias reach Postgres on localhost via host networking.
  CONTAINER_DATABASE_URL="$HOST_DATABASE_URL"
fi

DOCKER_RUN_FLAGS=(--rm)
if [ "$CONTAINER_DATABASE_URL" = "$HOST_DATABASE_URL" ]; then
  DOCKER_RUN_FLAGS+=(--network host)
else
  DOCKER_RUN_FLAGS+=(--add-host=host.docker.internal:host-gateway)
fi

run_in_image() {
  docker run "${DOCKER_RUN_FLAGS[@]}" \
    -e "DATABASE_URL=${CONTAINER_DATABASE_URL}" \
    -e "NODE_ENV=production" \
    "$IMAGE" \
    "$@"
}

echo "Preparing disposable PostgreSQL fixtures..."
npm run setup >/dev/null
npx tsx scripts/cleanup-docker-fixtures.mts seed >/tmp/cleanup-docker-seed.json
BEFORE="$(npx tsx scripts/cleanup-docker-fixtures.mts snapshot)"

echo "Building production runtime image..."
docker build -t "$IMAGE" .

echo "Checking required runtime files exist in the image..."
docker run --rm "$IMAGE" sh -c 'test -f app/lib/test-customer-cleanup.server.ts && test -f tsconfig.json && test -f scripts/cleanup-test-customer.mts'

echo "Running nonempty dry-run inside the final image..."
NONEMPTY="$(
  run_in_image npx tsx scripts/cleanup-test-customer.mts \
    --email=aprilbalaga@yahoo.com \
    --shop=cleanup-docker-runtime.myshopify.com \
    --dry-run
)"
printf '%s\n' "$NONEMPTY" | rg -q 'REQ-DOCKER-TARGET'
printf '%s\n' "$NONEMPTY" | rg -q '"requests": 1'

echo "Running empty-result dry-run inside the final image..."
EMPTY="$(
  run_in_image npx tsx scripts/cleanup-test-customer.mts \
    --email=missing-customer@example.com \
    --shop=cleanup-docker-runtime.myshopify.com \
    --dry-run
)"
printf '%s\n' "$EMPTY" | rg -q 'Nothing to delete'

echo "Exercising offline Shopify import path with safe test env..."
OFFLINE="$(
  docker run "${DOCKER_RUN_FLAGS[@]}" \
    -e "DATABASE_URL=${CONTAINER_DATABASE_URL}" \
    -e "NODE_ENV=production" \
    -e "SHOPIFY_API_KEY=cleanup-docker-test-key" \
    -e "SHOPIFY_API_SECRET=cleanup-docker-test-secret" \
    -e "SHOPIFY_APP_URL=https://cleanup-docker-test.example" \
    -e "SCOPES=write_products" \
    "$IMAGE" \
    npx tsx scripts/cleanup-test-customer.mts \
      --email=aprilbalaga@yahoo.com \
      --shop=cleanup-docker-runtime.myshopify.com \
      --dry-run 2>&1
)"
printf '%s\n' "$OFFLINE" | rg -q 'could not load offline Shopify Admin session'

echo "Running mocked Shopify audit helper inside the final image..."
MOCK="$(
  run_in_image npx tsx scripts/cleanup-docker-shopify-mock.mts
)"
printf '%s\n' "$MOCK" | rg -q '"ok": true'

AFTER="$(npx tsx scripts/cleanup-docker-fixtures.mts snapshot)"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "Fixture snapshot changed after dry-runs:" >&2
  echo "before: $BEFORE" >&2
  echo "after:  $AFTER" >&2
  exit 1
fi

echo "Cleanup Docker runtime verification passed."
