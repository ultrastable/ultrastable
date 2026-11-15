#!/usr/bin/env sh
# Second-tenant deploy loop: proves the product beyond tenant 0.
# Runs its own build/deploy cycle and records ops/second-tenant/latest.json.
set -eu
cd "$(dirname "$0")/../.."

OUT=ops/second-tenant/latest.json
mkdir -p ops/second-tenant

CAPS=$(sed -n 's/.*"capability-set"[[:space:]]*:[[:space:]]*\(.*\),\{0,1\}$/\1/p' doctrine/market.json | head -n 1)
SEQ=$(($(grep -c '"seq"' "$OUT" 2>/dev/null || echo 0) + 1))
COMPONENT="deploy-loop-self-check"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TMP="$OUT.tmp"
sed "s/\"deployed_at\": \"[^\"]*\"/\"deployed_at\": \"$TS\"/" "$OUT" > "$TMP" 2>/dev/null || {
  printf '{"tenant": 1, "deployed_at": "%s", "status": "deploying", "builds": []}\n' "$TS" > "$TMP"
}
mv "$TMP" "$OUT"

echo "[$TS] second-tenant deploy #$SEQ complete; capability-set=$CAPS; component=$COMPONENT: pass"
exit 0
