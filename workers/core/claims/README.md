<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/claims

Work claims, fences, secret lease, deploy lock and reconciliation hooks, written to US-SPEC-08 (primary), with US-SPEC-07 (control-plane claims), US-SPEC-09 (kill switch) and US-SPEC-14 (ports). Generic: no tenant names, no platform imports.

## Use

```js
import { acquire, heartbeat, release, check, reapExpired, reconcile, handle } from './index.js';
const ctx = { db, now: () => Date.now(), config: { claim_ttl_minutes: 120, lease_ttl_minutes: 2 },
              killSwitch: async () => false, authorize: async req => true };
const claim = await acquire(ctx, { path: 'src/app.js', holder: 'agent-1', intent: 'fix login' });
// claim.token (shown once), claim.fence; the protected resource calls check(ctx, {path, token, fence}) before each write.
```

Ports: `db` (D1-style), `now()` (ms, Date or `YYYY-MM-DD HH:MM:SS`), `config`, optional `killSwitch()` and `authorize(request)`. `handle(request, ctx)` routes `/work-lock|/deploy-lock|/secret-lock` + `acquire|heartbeat|release|check` (POST) and `status` (GET); POST is refused with 401 unless `ctx.authorize` exists or `config.allow_unauthenticated` is true. Config: `claim_ttl_minutes` (120), `lease_ttl_minutes` (2), `deploy_ttl_minutes` (15), `max_ttl_minutes` (240), `rework_threshold` (3), `escalation_role`.

Migrations: `migrations/0001_claims.sql` (tables `claims_*`; a partial unique index makes "one live claim per key" a store guarantee, so a race has exactly one winner), `migrations/0002_gate.sql` (parent links, closure blocks, visibility readings, gate lines), `migrations/0003_claims_pr.sql` (the pull request a claim is linked to) and `migrations/0004_wbs.sql` (optional WBS codes). Tokens are 256-bit values from `crypto.getRandomValues`; only a SHA-256 hash is stored, and no event, status, log line or idempotency record contains one. Item claims are mirrored into the seed `claims` table so the seed tick's dispatch and reaper keep working (the seed tests are unchanged).

## Requirements

| ID | Level | Status | Where |
|---|---|---|---|
| US-08-R01 one live claim per item | L1 | BUILT | `acquire`; unique index; tests T01, contention |
| US-08-R02 expiry and reaper returns item to ready | L1 | BUILT | `reapExpired`; T02, seed-reaper agreement |
| US-08-R03 untriggered item not dispatched | L1 | BUILT at the claim and in the claims step. `acquire` refuses `trigger_not_done`; `gate.js` `enforceTriggers` demotes a `ready` item whose trigger was reopened. The dispatch query of the core tick has no trigger predicate (an integration item), so one dispatch can happen before the step runs | `triggers.js`, `gate.js`; `triggers.test.js`, T04 |
| US-08-R04 no exit without disposition | L1 | BUILT (hook; the tick has its own) | `reopenSilentDrops`, `reconcile`; T03 |
| US-08-R05 gate card closes on probe | L1 | BUILT in `core/src/tick.js` (`probe_gates`); proven here with the held-item release | `triggers.test.js` |
| US-08-R06 heartbeat renewal | L1 | BUILT | `heartbeat` |
| US-08-R07 token, expiry, fence = previous + 1 | L2 | BUILT | `acquire`; T05 |
| US-08-R08 write only for live token and current fence | L2 | BUILT as `check`, `guardedWrite` and `fenceGuardSql` for the protected resource to call; no protected resource in this repository calls them yet (`core/runner` is an integration item) | `index.js`; T05, `claims.test.js` |
| US-08-R09 do not duplicate a live claim | L2 | BUILT | refusal with `same_intent` and shepherd advice |
| US-08-R10 record queue pulls | L2 | BUILT (`recordPull`; the tick's `dispatches` row is the pull record of the in-store path, `recordPull` is for outside pullers) | |
| US-08-R11 accounting invariant | L2 | BUILT per loop run; reopens unaccounted items, opens incident. As a gate: ancestors of unaccounted items cannot close, a parent closed around the gate is reopened, and a loop with an open gap does not pass | `recordLoopRun`; T06; `gate.js` (`recordLoopRunGated`, `closureAllowed`, `closeItem`, `enforceGate`, `loopGate`), `gate.test.js` |
| US-08-R12 rework escalation | L2 | BUILT (`recordRework`; no caller outside tests yet: `core/runner` keeps its own counter) | |
| US-08-R13 orphan metric | L2 | BUILT | `metrics().orphaned_claims` |
| US-08-R14 interrupt-eligible step becomes one gate card | L2 | BUILT | `escalateToGate` |
| US-08-R15 idempotency keys on boundary side effects | L3 | PARTIAL: `idempotency_key` on acquire, release, loop runs; side effects outside this module are the caller's | |
| US-08-R16 several-item and gate triggers | L2 | BUILT | `triggers.js`, `gate.js`; `triggers.test.js` |
| US-08-R17 a held item returns when its card closes | L2 | BUILT | `gate.js` `releaseHeld`; `triggers.test.js` |
| US-08-R18 check refuses under the kill switch | L2 | BUILT | `check` answers 503 `kill-switch`; `claims.test.js` |
| US-08-R19 claim released with its terminal item or pull request | L2 | BUILT for the port and its REST reader; PLANNED for the host wiring (no step calls `reapClosedPulls` on a clock, and no host binds `restPullReader` to its API root and token) | `releaseTerminal`, `releaseForPull`, `reapClosedPulls`, `restPullReader` (`pullreader.js`); `claims.test.js`, `pullreader.test.js` |
| US-08-R20 unworked release recorded and the item parked | L2 | BUILT in `core/src/tick.js` (`reap_claims`); proven here against the claims store | `claims.test.js` |
| US-08-R21 test and write in one operation | L3 | BUILT | `guardedWrite`, `fenceGuardSql`; `claims.test.js` |
| US-08-R22 retention | L3 | BUILT for the function; PLANNED for the schedule (nothing in the composition root calls `reconcile` or `pruneIfDue`, so tables are not pruned by a running organization until a `claims_prune` step exists) | `prune`, `pruneIfDue` (once a day, from `reconcile` when a host calls it); `claims.test.js` |
| US-08-R23 one identity-line rule across modules | L2 | BUILT in claims; shared with `core/trust` for stored lines and `env:` probes; PLANNED in `core/trust` for a line written only into `why_gated` (trust's `rerouteUnbound` reroutes that card; recorded by the `US-08-R23 deviation` test) | `gate.js` `cardsWithoutIdentityLine`; `identity.test.js` |
| US-08-R24 row-level tenant isolation | L3 | BUILT in the seed (seed/worker/src/tenant.js at the repository root); not in this module, whose store is one tenant's | seed/worker/test/spec-08-claims.test.js (repository root) |
| US-08-R25 owner-only items held under one card | L2 | BUILT in the seed (seed/worker/src/doer.js at the repository root) | seed/worker/test/spec-08-claims.test.js (repository root) |
| US-08-R26 WBS codes | L3 | BUILT, optional | `wbs.js`; `wbs.test.js` |
| US-08-R27 trigger scan pages and reports a cut | L2 | BUILT | `gate.js` `enforceTriggers` (`trigger_scan_max`, `trigger_scan_pages`, `truncated`, `scan-truncated` event), `triggers.js` `triggered`; `triggers.test.js` |
| US-09 kill switch refuses claims, renewals, leases | cross-ref | BUILT (via `killSwitch()` port or `config.kill_switch`) | |
| US-14-R01 / R02 ports only | L1 | BUILT | no platform imports |
| US-14-R11 contention on a scale-out store | L3 | NOT COVERED: proven on one SQLite handle only; a multi-writer store needs the same unique-index semantics | |
| Visibility ratio across multiple issue stores (US-08 section 5) | L2 | BUILT against a `stores` port (each store lists key and status); `stores.js` `pagedStore` turns a tracker's pages into one without truncating silently; the REST adapter that supplies `listPage` is the host's | `gate.js` `visibilityRatio`; `stores.test.js` |
| Principal-queue reroute of cards lacking an identity-bound line (US-08 section 6) | L2 | BUILT: `routeToPrincipal` holds or reroutes a step; `cardsWithoutIdentityLine` is the metric (target 0); `rerouteCards` closes such cards and moves the step to the staff. A card counts as having a line when `claims_gate_lines` or `core/trust`'s `trust_gate_meta` stores one, when its closing probe is `env:<NAME>`, or when its `why_gated` text names one of `identity_patterns` | `gate.js`; `identity.test.js` |

Secret lease: exclusive, TTL fixed by `lease_ttl_minutes`, keyed by secret name; any request carrying a value field is refused. Deploy lock: same primitives, TTL `deploy_ttl_minutes`.

Limit: claims are advisory except where the protected resource calls `check`, `guardedWrite` or puts `fenceGuardSql` in its write statement. A stalled holder that never calls them is not stopped by the fence.
