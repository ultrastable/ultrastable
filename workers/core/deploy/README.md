<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/deploy: the canonical change path

Implements the deploy half of US-SPEC-07 section 4 independent of any cloud. `createDeploy({ db, deployer, fetch, now, sleep, config, env, lock?, killSwitch?, probes? })` returns `{ deploy, reconcile, handle, ledger, closeGate }`.

`deploy({ unit, artifact, expectedVersion, actor })`: kill-switch and open-gate check, lock, live-version check (stale refused), ledger row, baseline probes, `deployer.publish`, probes polled until all pass or the window closes, then keep or `deployer.rollback` (verified by `liveVersion`). After `breakerThreshold` (default 3) consecutive reverts of one unit a gate-style record opens in `deploy_records` and further deploys of the unit are refused until `closeGate(id)`.

Ports: `db` (D1-style), `deployer` (`publish`, `liveVersion`, `rollback`; adapters in `adapters/cloudflare/deployer.js` and `adapters/gcp/deployer.js`), `fetch`, `now`, `sleep`, `lock` (`acquire(unit, holder, ttlMs) -> token|null`, `release`; built-in `dbLock`), `killSwitch`. Probes are data (`http`: url, status, contains, version; `db`: sql, expect) given in `probes[unit]` or the `deploy_units` table. HTTP: `POST /deploy`, `POST /reconcile`, `GET /ledger?unit=`, all behind an `x-deploy-token` header that must match `env.DEPLOY_TOKEN` (no token configured: everyone refused).

Migrations: `migrations/0001_deploy.sql`, `migrations/0002_review.sql` (tables `deploy_*`, idempotent). Only digests and versions are stored; any configured env value is redacted from stored text.

## Requirement status

| Requirement | Status | Where |
|---|---|---|
| US-07-R12 deploys of one component serialized by a lock | BUILT | `lock.js`, tests "serialized", "expired lock" |
| US-07-R12, US-05-R09 probe that passed before and fails after reverts | BUILT, stricter: any failing probe after publish reverts (baseline results are recorded, not used to exempt). A probe marked `revert: false` (shared resource under load) is recorded and never reverts | `index.js`, `probes.js`, test "US-05-R09" |
| US-07-R13 ledger row records the version; artifact compared with source | BUILT: versions and SHA-256 recorded; an optional `artifact.sha256` must match, and when the deployer has `liveDigest(unit)` the live digest (a string, or a per-file map) is compared inside the polling window and a mismatch is a failed `artifact:digest` probe that reverts | ledger tests, "US-07-R13" tests. The Cloudflare adapter supplies `liveDigest` (`adapters/cloudflare/deployer.js`, one SHA-256 per module, tested with a fake fetch). Comparison against a source repository stays with the platform deploy script (`deploy/deploy-workers.mjs`) |
| US-07-R27 stale version, kill switch and the 3-revert breaker refuse and publish nothing | BUILT | `index.js`, tests "US-07-R27" |
| US-07-R28 a rollback is verified by reading the live version back | BUILT | test "US-07-R28" |
| US-07-R29 a change made outside the path is detected against the ledger | BUILT | `reconcile`, tests "US-07-R29" |
| US-06-R25, US-05-R13 deploy asks `authorize` and `confidence` ports before acting | BUILT | `index.js` (ports `authorize`, `confidence`; `Trust.deployAuthorizer`, `Predict.confidenceGate` build them), deploy tests |
| US-07-T05, US-05-T04 failing probe reverts, failure item filed | BUILT: ledger row `reverted` with reason, and an item `DEPLOYFAIL-<unit>-<ledger id>` in the seed `items` table whose closing probe passes when a later deploy of the unit is kept (`config.fileItems = false` turns it off; a store without `items` keeps the reason on the ledger row) | test "US-05-T04, US-07-T05" |
| US-07-R09 control-plane change only by reviewed change | BUILT in `core/runner` (protected paths) and the platform lane; not in this module | |
| US-07-R01..R08, R14..R17, R24, R30, R31 governance, recognition, goals | BUILT in `core/governance` | |
| US-07-R10 two reviewers of disjoint families, neither the author's | BUILT: `createReviewGate` picks them from the roster; a risk-class change that cannot get them is held (hold mode) | `review.js`, `review.test.js` |
| US-07-R11 hold computed by code from verified findings; diff treated as data | BUILT: a finding without a trigger is dropped, a high finding whose evidence line is not verbatim in the diff is demoted, reviewer verdicts are ignored, the diff travels in its own field | `review.js` (`verifyFindings`), test "US-07-T04" |
| Review gate modes `observe`, `hold`, `off`; fails open on reviewer outage; cost per run; new push releases the hold | BUILT | `review.js`, table `deploy_review_runs` |
| US-07-R18, US-07-R26 merge guard: a hold marker, a missing, queued or failed required check, an empty list on a fresh head, an unreadable answer all hold | BUILT: `createMergeGuard({ reviewGate })` (`mergeguard.js`), the port of the platform's `greenguard.js`. Calling it from a merge step (`tools/safe_merge.py`, the lane) is an integration request | `mergeguard.test.js` |
| US-07-R10 reviewer roster from the model ladder | BUILT with a fake fetch: `reviewersFromRouter` (`review-ports.js`); the router's reviewer-not-doer-family rule holds a second time. Live run PLANNED | `review-ports.test.js` |
| US-09-R02 global kill switch refuses deploy leases | BUILT for deploys: `deploy_config kill_switch=on` or injected `killSwitch` | test "kill switch" |
| US-06-R08/R09 gate-style record with closing probe and default in effect | BUILT in form (`deploy_records`, probe `manual`, default stated); linking to seed `gate_cards` PLANNED | loop breaker tests |
| US-06-R10 only presence of secrets recorded | BUILT: values never stored, redacted from stored text | test "no secret value" |
| US-14-R01 core calls no platform API | BUILT: all platform access via ports | `index.js` |
| US-14-R08 deploy port supports revert to prior version | BUILT: `rollback(unit, toVersion)` in both adapters | adapter tests |
| Unlogged mutations detected | BUILT: `reconcile(unit)` writes an `unlogged` ledger row and an open `deploy_records` entry. Scheduling reconcile is the caller's job | test "unlogged" |
| Cloudflare Workers adapter | BUILT against the public HTTP API with a fake fetch; not run against a live account | `adapters/cloudflare/` |
| Cloud Run adapter | PLANNED skeleton, fake-fetch tested; long-running-operation polling absent | `adapters/gcp/deployer.js` |
| Multi-step deploy window with gradual traffic shift | PLANNED | |

## Ops agent (`agent.js`)

`step({ db, deploy, liveVersion, sources })` drives this change path from work items: an open item whose `done_check` contains `deploy-unit: <unit>; version: <v>` is a deploy request. `sources` is an ordered list of artifact sources (first that returns an artifact wins). `kept` closes the item with the ledger id; `reverted`, `failed` or `refused` (loop breaker, kill switch, stale version) leave it open with the reason as its blocker. Owner role: operations. Trigger: every tick (2 items max). Closing probe: the item is `done` with a ledger id, or carries a blocker. Status: BUILT (`agent.test.js`). Wiring into `core/org` steps: NOT COVERED (opt-in, needs a configured deployer).

## Class D pack route (`packs-route.js`)

`createPacksRoute({ deploys, plan, allow? })` returns the `deployRoute` port for `createPacks`. The pack guard calls it, instead of a channel port, for every send of a class D pack; `plan(req)` maps the approved request to `{ provider, unit, artifact, expectedVersion }`, `allow(pack, unit)` can restrict units, and the call goes through `createDeploy(...).deploy` (kill switch, lock, version check, probes, revert). Only a `kept` deploy counts as sent. Status: BUILT (`packs-route.test.js`).

## Review gate (`review.js`)

`createReviewGate({ db, now, config: { mode, riskClasses }, reviewers: [{ name, family, review(input) }] })` returns `{ review, mergeAllowed, runs }`. `review({ id, head, diff, files, authorFamily })` detects the risk classes (authentication, routes, caching, data migrations, workflow permissions; patterns are configuration), sends the diff as data to two reviewers of disjoint families, verifies their findings against the diff by code, and writes a hold marker (`deploy_review_holds`) when a verified high finding remains. Reviewers are ports; no model ships with the module and none has run it live. Status: BUILT (`review.test.js`).
