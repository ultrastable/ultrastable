# Path: Google Cloud

`platform/adapters/gcp/` runs the same tick on Cloud Run with a SQLite volume. To exercise it in a container or CI job: `TICK_TOKEN=x ULTRASTABLE_DB=./tick.db node --no-warnings platform/adapters/gcp/server.js`, then POST `/tick` on port 8080 of that container with the header `X-Tick-Token: x`. Test: `node --test --no-warnings platform/adapters/gcp/test/*.js`. The live deploy script is unrun.
