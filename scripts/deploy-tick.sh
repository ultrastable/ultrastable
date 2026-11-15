#!/usr/bin/env sh
# Deploy ultrastable-tick (D1 + AI binding). Two auth routes:
# 1) built-in token: CLOUDFLARE_API_TOKEN set in env
# 2) cloud-session: CLOUDFLARE_SESSION cookie obtained via `wrangler login`
set -eu

: "${CLOUDFLARE_API_TOKEN:-}"
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
  echo "deploy route: built-in token"
else
  echo "deploy route: cloud-session (wrangler login state)"
fi

npx wrangler deploy

# Probe the live route
URL="${TICK_URL:-https://ultrastable-tick.workers.dev/health}"
curl -fsS "$URL" && echo "tick live"
