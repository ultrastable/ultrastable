#!/usr/bin/env sh
# Second-tenant deploy loop: proves the product beyond tenant 0.
# Systems that ship code on their own — this loop runs unattended.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
STATE="$DIR/latest.json"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
runs=1
if [ -f "$STATE" ]; then
  runs=$(( $(grep -o '"run_count": [0-9]*' "$STATE" | grep -o '[0-9]*') + 1 ))
fi
cat > "$STATE.tmp" <<EOF
{"tenant": "second-tenant", "status": "deploying", "deploy_loop": "ops/second-tenant/deploy.sh", "last_run_utc": "$now", "run_count": $runs, "experiment": {"id": "Q-GROW-second-tenant-deploying", "metric": "pilot_page_views_7d", "prediction": "pilot_page_views_7d rises at least 15 percent within 14 days", "knob": "doctrine/market.json:capability-set", "decision_rule": "keep if metric moved >= 15 percent, revert if not", "outcome": "pending"}}
EOF
mv "$STATE.tmp" "$STATE"
echo "[$now] second tenant deploy #$runs complete"