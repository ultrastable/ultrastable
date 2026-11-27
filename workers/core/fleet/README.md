<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/fleet: the fleet runtime

Schedulers start work, an executor does it and records it, and a dead-man check notices a scheduled slot with no record. Written to US-SPEC-11. Generic: no tenant names, no platform imports. Nothing here is RUNNING: no production use. The composition root runs `step` each tick (`core/org/buildout.js`) but supplies no `executor`, `ai`, `bindings` or `deployed` port and mounts no `/fleet` route; a due task runs inline against its own database.

```js
import * as fleet from './index.js';
const ctx = { db, now: () => Date.now(), config: { worker: 'fleet', allowed_models: [{ id: 'small', cost: 1 }] }, fetch, ai, deployed, claims };
ctx.executor = m => fleet.execute(ctx, m);          // optional: with no executor the module runs the task inline; or post to another worker's /fleet/execute
await fleet.step(ctx);                              // (stagger,) dispatch due rows, reap stale runs, dead-man check, reconcile when due, settle items, cadence report
```

Ports: `db` (D1-style), `now()`, `config`, optional `fetch`, `ai({model, prompt, max_tokens})`, `bindings` (named databases for sql tasks), `executor(msg)`, `sleep(ms)` (timeouts and retry backoff), `deployed.list()` (platform metadata; `adapters/cloudflare/src/metadata.js` `cloudflareDeployed`), `claims` (the core/claims module), `authorize(request)`. Migrations: `migrations/0001_fleet.sql`, `migrations/0002_fleet_deadman.sql`, `migrations/0003_fleet_stagger.sql`, `migrations/0004_fleet_task_options.sql` (tables `fleet_*`). Tests: `fleet.test.js`.

## Requirements

| ID | Status | Where |
|---|---|---|
| US-11-R01 worker contract (seven parts) | BUILT. The reference worker and the seed answer `/health` as `{ok, ...}` without worker, version, enabled or bindings_ok: PLANNED | `contractGaps`, `register` (secret names only), `health`, `normalizeHealth` |
| US-11-R02 registry is the census authority; deployed state reconciled on a schedule | BUILT against a `deployed.list()` port, including the cron comparison; the live adapter is BUILT over a fake fetch (`adapters/cloudflare/src/metadata.js`), the call with a real account is PLANNED | `reconcile`, `step` |
| US-11-R03 next_fire and last_fired advance whether or not dispatch succeeded | BUILT | `dispatch`; T02 |
| US-11-R04 a schedule change is a row write | BUILT | `fleet_crons`, `setCron` |
| US-11-R05 unknown task types rejected; a run record for every execution, a rejected request included | BUILT | `execute`; T03 |
| US-11-R06 envelopes validated before writing; rejects stored with their error | BUILT | `validateEnvelope`, `recordEvent` |
| US-11-R07 accounting invariant per batch, as a gate | BUILT | `recordBatch`, `drain`, `batchGate` |
| US-11-R08 dead-man check from declared cron expressions, slots missed while the check was down included | BUILT (checkpoint and 24 hour lookback) | `deadman`, `expectedSlots`; T04 |
| US-11-R09 single-path failure distinguished from a stop | BUILT | `deadman` (alert kinds, priorities, per-scheduler reliability) |
| US-11-R10 one acting firing per slot under a work claim | BUILT | `fireOnce`; T05 |
| US-11-R11 overlap guard (one conditional insert) and reaper for stale queued and running rows | BUILT | `dispatch`, `emit`, `reapStale` |
| US-11-R12 collisions measured; schedules staggered | BUILT by two planners: `stagger` plans a day window by default and writes rows with `apply`, and `step` applies it with `config.auto_stagger`; `staggerHourly` (pin list, procedure sync, log) runs with `config.stagger_auto`, moving only periodic or single-minute expressions | `collisions`, `minutePhase`, `stagger`, `staggerHourly` |
| US-11-R13 monitor hosted outside the writer of its probe table | BUILT in core/remediation (`externalLiveness`); a test here cites it | `fleet.test.js` |
| US-11-R14 event-triggered scheduling | BUILT | `setTrigger`, `emit` |
| US-11-R15 to R19 second producer, watched watchers, loop clocks, cron budget | NOT IN this repository: BUILT in the platform's seed and foundation commands (loop clocks, watchers, cron budget); see US-SPEC-11 section 11 for the files and tests | |
| US-11-R20 items close when their reading clears and reopen on recurrence | BUILT | `settleItems`, `openItem` |
| US-11-R21 per-task timeout and bounded retries, an attempt per run row | BUILT | `setTask`, `execute` |
| US-11-R22 envelope carried as a CloudEvents 1.0 event | BUILT | `toCloudEvent`, `fromCloudEvent`, `validateCloudEvent` |
| Eleven-column run ledger | BUILT | `fleet_runs` |
| Hot standby | NOT IN this repository: BUILT in the platform (a second producer route and a GitHub Actions watchdog); this repository has no second producer route: PLANNED | |
| US-11-T01 next_fire('*/10 * * * *', 12:03) = 12:10 | BUILT | `nextFire` |

Cadence: `dispatch` is one pass per call, not one per minute; the composition root calls it at the ten-minute tick. `cadenceReport` lists schedules finer than that and `POST /fleet/dispatch` (authorized) lets a finer scheduler drive it.

Limits: cron is five fields in UTC with the term forms of the spec (`*`, `*/n`, `a-b`, a literal, comma lists); names such as MON, `a-b/n` and `a/n` are not accepted. The `ai` task calls whatever gateway port it is given; cost is what the port reports. A timeout does not cancel the work.
