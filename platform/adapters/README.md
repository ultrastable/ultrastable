# Adapters

The portable core is `seed/worker/src/tick.js`. Adapters supply a scheduler and a D1-style store. Architecture, seams and status: [../docs/architecture.md](../docs/architecture.md).

| Adapter | Where | Status |
|---|---|---|
| Cloudflare (Worker, Cron, D1) | `seed/worker/` | running for QNFO; seed template tested by <!-- claim:seed-worker-tests -->501 Worker tests<!-- /claim -->; no `--apply` on a fresh account yet |
| Google Cloud (Cloud Run, Cloud Scheduler, volume) | `gcp/` | skeleton with <!-- claim:gcp-tests-adapters -->2 tests<!-- /claim --> in CI; deploy script unrun |
| SQLite handle (shared by GCP and the selfhost path) | `sqlite/` | tested via GCP tests |

Run the GCP adapter in a container or CI job: `TICK_TOKEN=x ULTRASTABLE_DB=./tick.db node --no-warnings platform/adapters/gcp/server.js`, then POST `/tick` on port 8080 of that container with the header `X-Tick-Token: x`.
Test: `node --test --no-warnings platform/adapters/gcp/test/*.js`.
