# Path: Google Cloud

`platform/adapters/gcp/` runs the same tick on Cloud Run with a SQLite volume: `TICK_TOKEN=x ULTRASTABLE_DB=./local.db node --no-warnings platform/adapters/gcp/server.js`, then `curl -XPOST -H 'X-Tick-Token: x' localhost:8080/tick`. Test: `node --test --no-warnings platform/adapters/gcp/test/*.js`. The live deploy script is unrun.
