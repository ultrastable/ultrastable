#!/usr/bin/env sh
# First run on a new Cloudflare account, no token to create or paste: `wrangler login` opens the browser and you click Allow.
# Idempotent: safe to run again. Falls back to the local loop when Cloudflare cannot be reached, so the loops never stop.
set -u
cd "$(dirname "$0")/../.."
if command -v npx >/dev/null 2>&1 && npx --yes wrangler@4 login; then
  ACCOUNT="$(python3 -c 'import json;print(json.load(open("deploy/cloudflare-accounts.json"))["target"]["id"])')"
  export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT"
  python3 -m foundation launch --export-d1 .selfhost/records.sql
  (cd seed/worker && npx --yes wrangler@4 d1 create ultrastable-org; npx --yes wrangler@4 d1 migrations apply ultrastable-org --remote; \
   npx --yes wrangler@4 d1 execute ultrastable-org --remote --file ../../.selfhost/records.sql; npx --yes wrangler@4 deploy) \
   || echo "cloudflare step failed; the local loop keeps running (see below)"
else
  echo "Cloudflare sign-in not available; starting the credential-free local loop instead"
fi
ULTRASTABLE_HOST=first-run python3 -m foundation launch --commit
