#!/usr/bin/env bash
# DRIFT-1: compare what is live with what the repo declares, and self-heal what the repo token can reach.
#  - site: live /health version vs site/worker.js VERSION; on drift dispatch deploy-site (repo-scoped token suffices).
#  - org: public org description/homepage vs github/org-settings.json; org writes need an org-admin token, so drift is reported red
#    (the run fails, the next org-settings workflow run with the admin token closes it).
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"; fail=0
want=$(sed -n 's/^var VERSION = "\(.*\)";/\1/p' site/worker.js | head -1 | tr -d '\r')
got=$(curl -fsS "https://ultrastable.io/health?v=$RANDOM" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])') || got=unreachable
echo "site: live=$got repo=$want"
if [ "$got" != "$want" ]; then
  echo "DRIFT site: dispatching deploy-site"
  gh workflow run deploy-site.yml -R "$repo" --ref main || fail=1
fi
# DEPLOY-ALL-1: every deployed Worker's code against main, daily. Any difference re-dispatches the deploy, which verifies itself.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  node deploy/deploy-workers.mjs --verify || { echo "DRIFT workers: dispatching deploy-workers"; gh workflow run deploy-workers.yml -R "$repo" --ref main || fail=1; gh workflow run deploy-system.yml -R "$repo" --ref main || fail=1; }
else
  echo "workers: verify skipped (no Cloudflare token in the lane job)"
fi
org=$(python3 -c 'import json;print(json.load(open("github/org-settings.json"))["org"]["description"])' | tr -d '\r')
live=$(curl -fsS https://api.github.com/orgs/ultrastable | python3 -c 'import sys,json;print(json.load(sys.stdin).get("description") or "")') || live=unreachable
echo "org: live='$live'"
[ "$live" = "$org" ] || { echo "DRIFT org description differs from github/org-settings.json"; fail=1; }
safe_exit
exit $fail
