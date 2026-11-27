<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/remediation: failure modes beside the register

The register of failure modes, the remediation contract (owner, doer, trigger, closing probe, retry bound, deadline) and the loop breaker are in core/kernel (`../kernel/failure.js`). This module adds what the register does not hold and reads the kernel tables; it changes no kernel code. Written to US-SPEC-17. Nothing here is RUNNING.

```js
import * as remediation from './index.js';
const ctx = { db, now: () => Date.now(), config: { host: 'watcher', liveness: [{ table: 'probe_log', interval_min: 15, writer: 'prober' }] }, probeDb, rosters, ledgers };
await remediation.installStandard(ctx, { frozen: [{ table: 'probe_log', interval_min: 15 }] });
await remediation.step(ctx);
```

Migrations: `migrations/0001_remediation.sql` (tables `remediation_*`; apply after the kernel and claims migrations) and `migrations/0002_state.sql` (relapse counts, firing links, pass streaks, breaker sources and log). The kernel code guards every read of the second file's tables, so a store with only the kernel migrations still works, without relapse counting. Tests: `remediation.test.js`, `../kernel/failure.test.js`.

The second-worker host of the liveness detector is `liveness-host.js` (`createLivenessHost`, `livenessWorker`) with `wrangler.liveness.template.jsonc` (placeholders only). Its credential-free route is `httpLiveness`: read a health endpoint, take the clock from the same response.

## Requirements

| ID | Status | Where |
|---|---|---|
| US-17-R01 one hit row per run | BUILT in the kernel for registered detectors; BUILT here for the detectors this module hosts | `remediation_hits` |
| US-17-R02 clock in the same statement as the data | BUILT | `frozenSql`, `coverageSql` |
| US-17-R03 detector and severity; found twice without a detector is registered | BUILT | `installStandard`, `reportFailure` |
| US-17-R04 to R09 contract, consumer, closing probe, escalation, breaker, probation | BUILT in the kernel | `../kernel/failure.js`, `../kernel/failure.test.js` |
| US-17-R08, R29 breaker for a ledger whose writer has none, re-armed by a changed source hash | BUILT | `breakerFromLedger`, `retryAllowed` |
| US-17-R10 one detector hosted outside the writer of its probe table | BUILT: `externalLiveness` refuses to run in the writer, `httpLiveness` needs no credential, `liveness-host.js` is the deployable host. Deploying the second Worker is PLANNED (a live account) | `externalLiveness`, `httpLiveness`, `liveness-host.js` |
| US-17-R11 visibility ratio across issue stores | BUILT in core/claims, exported here | `../claims/gate.js` |
| US-17-R12 roster reconciliation with the emitter set | BUILT | `rosterReconcile`, `observedEmitters` |
| US-17-R13 a repository fix is not closed on repository evidence alone | BUILT | `closeFix` |
| US-17-R30 FM-MASKED equals the structured classifier | BUILT | `maskedSql` |
| US-17-R31 FM-COVERAGE, FM-SHADOW, FM-STALE-PREDICATE | BUILT: coverage as a registrable detector, shadow and stale predicate as port checks (`candidates`, `alarms`) that fire when unreadable. No module in this repository produces a candidate list or alarm definitions | `coverageSql`, `shadowReconcile`, `stalePredicates` |
| US-17-R24 retention | BUILT | `prune`, `../kernel/failure.js` `pruneHits` |
| Status view over the register | BUILT | `statusView` (counts `exhausted`), route GET /failure-modes/status |
| Silent-drop reconciliation across loops | BUILT for the run ledgers of core/kernel, core/claims and core/fleet | `reconcileLoops` |
| entered = open + closed + superseded | BUILT: a vanished item is restored from an append-only ledger, an undisposed one reopened | `reconcileItems` |

Limit: detector statements that read time use the store's own clock, as the spec requires, so they are not driven by the injected `now`.
