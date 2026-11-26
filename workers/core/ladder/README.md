<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/ladder: model ladder persistence

Implements the persisted parts of `US-SPEC-09` sections 4 and 5 that `core/router` does not hold: the capability matrix, the admission pipeline, capability-first candidates, the cascade with measured escalation, draft-then-verify (L6), shadow sampling, the demotion step and cost per verified outcome. `core/router` makes the provider calls; this module decides which admitted model may be asked and records what happened. Ports: `db`, `now`, and per call `canary`, `run`, `validate`, `draft`, `repair`. Migrations: `migrations/0001_ladder.sql` and `migrations/0002_ladder_extras.sql` (tables and views `ladder_*`; the specification's `model_task_matrix` and `model_admission` carry the prefix). Consumers: `step({ db, now, config })` is the tick surface (demotion); failed tasks and demotions become rows in `items`.

```js
import * as ladder from './index.js';
await ladder.setFloor(db, [{ pattern: '-(mini|nano)\\b', reason: 'small class' }]);
await ladder.admit(db, { model, task_class, rung: 1, unit_cost, need: { tool_calls: true }, decision: true, sample, canary });
await ladder.cascade(db, { task_id, task_class, need, run: (row) => router.call(...), validate, capBreached });
await ladder.draftThenVerify(db, { task_id, task_class, draft, repair, checks });
if (ladder.shouldShadow(decisionId)) await ladder.recordShadow(db, { model, task_class, decision_ref: decisionId, model_answer, label });
await ladder.step({ db, now });
```

## Requirement status

BUILT means implemented here and covered by a passing test in this directory. Nothing here is RUNNING; every model port is a fake in the tests.

| Requirement | Status | Where |
|---|---|---|
| Persisted capability matrix (section 4 table) | BUILT | `ladder_model_task_matrix`, written only by `admit` |
| Admission pipeline 2302 to 2316 (floor, canary, agreement by Wilson lower bound, gate, rung row) | BUILT | `admit`, `ladder_model_admission` |
| US-09-R07 cap steers to a free rung, never ends a task with a free path | BUILT | `cascade({ capBreached })` or a `scheduler` port; the task is queued only when no free rung exists |
| US-09-R08 capability first; price a tiebreaker | BUILT | `candidates`, `canRoute`; `core/router` reads the matrix through its `matrix` port |
| US-09-R09 escalation on a measured signal, one rung per failure, bounded, failed task filed | BUILT | `cascade`, `ladder_attempts`; a dead transport (provider error) does not spend an attempt and the next row serves (`layers.test.js`) |
| US-09-R10 cost per verified outcome, escalation rate, cache hit rate, tool-call validity rate | BUILT | view `ladder_v_cost_per_task`, `cache.js` (`cacheHitRate`), view `ladder_v_tool_call_validity` |
| US-09-R11 floor at admission, on a floor change, and in source and deployed bundles | BUILT | `setFloor`, `floorViolation`, `monitor`; `floorguard.js` (`scan`, `floorGuardRun`, `cli-floor-guard.js`), `floorguard.test.js` |
| Standards gate (32,768 output, 128,000 context), exemption registry, all-layers verifier | BUILT | `standards.js`, table `ladder_exemptions`; `step({ config: { standards_models } })` runs it |
| US-09-R12 decision model gated by agreement lower bound | BUILT | `admit({ decision: true })` |
| Shadow sample of about 5% of decisions | BUILT | `shouldShadow`, `recordShadow`, `rollingAgreement`; scheduled answers `schedule.js` (`shadowRun`) |
| Scheduled canaries | BUILT with ports | `schedule.js` (`canaryRun`) and the router-backed ports `router-ports.js` (`createRouterCanary`, `createRouterAnswer`, tests `router-ports.test.js`). The organization's labels and decision list are the host's ports (PLANNED live) |
| Demotion step 2320, 2322 | BUILT | `monitor` |
| L0 deterministic handlers | BUILT | `layers.js` (`createL0`); the seed's doer module is the reference |
| L1 cache: exact, TTL, source-change invalidation, semantic, stable prefix | BUILT | `cache.js` (the exact key is the SHA-256 of the normalized input), tables `ladder_cache`, `ladder_cache_events` |
| L4 ensemble that samples only free or cached components | BUILT | `layers.js` (`ensembleSample`) |
| L5 exemplar bank | BUILT | `exemplars.js` (`serve` refuses a stored answer whose numbers differ from the input's and, without an embedder, serves only with a `validate`), table `ladder_exemplars`. A model trained offline stays PLANNED: it needs an organization's task history and a host |
| L6 draft then verify | BUILT | `draftThenVerify` |
| L7 per-class and organization daily caps, degradation order, queue for the next window | BUILT | `layers.js` (`budgetScheduler`, `queueNextWindow`, `reofferQueued`), table `ladder_queue` |

Tests: `ladder.test.js`, `floorguard.test.js` (floor guard and standards gate), `layers.test.js` (L0, L1, L4, L5, L7, fall-through, canaries, shadow).
Composition: `step({ db, now, config, ports })` runs the demotion step, the standards gate and, when `ports.canary` or `ports.answer` is supplied, the scheduled probes. The composition root passes no ports yet, so with `canary_every_h` or `shadow_rate` configured a tick reports "no canary port" in its notes; `router-ports.js` builds the canary and shadow-answer ports over `core/router`.
