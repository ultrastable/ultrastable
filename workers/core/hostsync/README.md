<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->
<!-- consumer: .github/workflows/host-sync.yml -->

# core/hostsync: the repository and its hosts stay one state (HOSTSYNC-1)

`reconcile({ host, declared, read, write, record, redeploy })` observes each declared script through a host adapter `{ id, observe(script) }`, writes the sanitized runtime state (module hash, binding names, cron schedules, workers.dev, compatibility; never a secret value) into `ops/hosting/state.json`, and asks the repository's deploy route to deploy again when the host differs from what the repository recorded. `gateway.js` is the adapter over the deploy gateway's read-only `GET /state` route (OIDC proof, no stored secret).

- Repo to host: `deploy-gateway.yml` records each verified deploy in `ops/hosting/expected.json`; a host whose module hash differs is redeployed by dispatching the declared workflow.
- Host to repo: `ops/hosting/state.json` and `events.jsonl` are written by the `host-sync` workflow (after a deploy, on a `host-changed` callback, daily).
- BUILT: gateway `/state`, diff, reconcile, workflow, tests. NOT COVERED: zone routes and D1 migration state, other hosts' adapters, wiring the tenant repositories (they declare their scripts in their own `deploy/hosting.json`).
