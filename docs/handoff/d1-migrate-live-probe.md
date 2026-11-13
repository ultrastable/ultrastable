---
consumer: doctrine/decision-ledger.json
---
# D1-MIGRATE-1 / LIVE-PROBE-1 handoff
Session: session_0156nqDrqcGCkj5y91Acz3sM
Closing probe: `node deploy/probe-live.mjs` (runs in deploy-workers.yml). Open: QNFO D1 budget (QNFO/qnfo-workers PR 11490).
Live finding 2026-11-13T18:40Z: tick 9/9, k_eff 0.1015 (k_min 1), sweeper_runs status errors: pulls 404 on all five repos (GitHub App installation does not cover them). Probe now fails on this. Session: session_0156nqDrqcGCkj5y91Acz3sM
REPO-ACCESS-1: seed/worker/src/auth/access.js detects uncovered repos each tick, keeps gate card GATE-REPO-ACCESS, /connect/repos redirects to the installation page, the setup callback re-probes. App cannot widen its own installation (GitHub requires the owner's click). Session: session_0156nqDrqcGCkj5y91Acz3sM
Live finding 2026-11-13T18:50Z: the App is registered under the personal account rwnq8 and installed there (selection all, 71 personal repos); none of the five ultrastable/* repos are covered. A user-owned private app cannot install on the org. access.js now adopts an org installation by code when one exists, else points /connect/repos at org-scoped registration (organizations/<owner>/settings/apps/new); /connect/github registers under the org. Session: session_0156nqDrqcGCkj5y91Acz3sM
