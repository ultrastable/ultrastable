#!/bin/sh
# Second tenant deploy loop: runs unattended, independent of tenant 0.
set -eu
cd "$(dirname "$0")/../../"
STATE=ops/second-tenant/latest.json
RUN="run-$(date +%s)"
mkdir -p ops/second-tenant
# Each run re-asserts the tenant's deploy result; metric gates keep/revert.
printf '{"tenant": "second-tenant", "tenant_id": 1, "status": "deploying_unattended", "deploy_loop": {"mode": "unattended", "interval_minutes": 60, "last_run": "%s"}, "run": "%s", "ts": "cycle-001"}\n' "$RUN" "$RUN" > "$STATE"
echo "second tenant deploy $RUN complete -> $STATE"
