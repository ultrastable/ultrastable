<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/lifecycle-gates: mode tailoring, iterations, status report, scope gate

Implements the requirements of `US-SPEC-15` that `core/kernel/lifecycle.js` leaves open. The kernel holds the five normative tables and the gates G1 to G3; this module adds the rules around them and calls the kernel's gate, never around it.

```js
import { startProject, submitTailored, advance, requestWork, lifecycleStep } from './index.js';
await startProject(db, { id: 'P', name: 'booking page', answers: {}, capacity: 3 }, { config: { portfolio_cap: 10 } });   // hybrid by default
await submitTailored(db, { project_id: 'P', kind: 'A-INI-2', path_or_ref: 'docs/P/charter.md', content: charter, produced_by: 'doer-1' });
await advance(db, 'P', 'planning', { readiness: (project) => elicit.readiness(project) });
await runTick(db, { config, extraSteps: [lifecycleStep()] });                                                             // status reports that are due
```

Ports: `db`, `now`, `config.lifecycle` (`portfolio_cap`, `initiation_threshold`, `require_readiness`, `status_period_h`, `scope_rules`, `auto_start`, `default_capacity`, `max_gap_items_open`), `readiness(project) -> number | { score }` (the readiness score of `US-SPEC-16`, served by `core/elicit`), `readback(project) -> { readback, fields }` (the person's answers, for drafting), `packs` (`isEnabled`, `enable`, `disable`, shaped like `core/packs`). The G1, G2 and G3 conditions this module adds are registered with the kernel (`registerGateExtra`), so the kernel's own `advancePhase` runs them. Migrations: `core/lifecycle-gates/migrations/0001_lifecycle_gates.sql` and `core/lifecycle-gates/migrations/0002_lifecycle_monitor.sql` (apply after the seed and kernel migrations).

## Requirement status

BUILT means implemented and covered by a passing test in `lifecycle-gates.test.js` (or the kernel's own). Nothing here is RUNNING.

| Requirement | Status | Where / note |
|---|---|---|
| US-15-R02 selection rule; an override is a recorded decision | BUILT | `selectMode`, `startProject`, `lifecycle_mode_decisions` |
| US-15-R03, R13 the mode changes weight and form only; nothing is omitted | BUILT | `requiredArtifacts`, `checkForm`, `submitTailored`. Field lists exist for A-INI-1, A-INI-2, A-INI-6, A-PLN-1, A-PLN-4, A-PLN-5, A-PLN-6, A-PLN-9; any other artifact must have some content |
| G1: definition of done is a runnable probe; readiness score at least the threshold | BUILT | registered conditions `charter-probe` and `readiness`; a score that cannot be read does not pass |
| US-15-R17, US-15-T08 G2: every requirement maps to an item with a closing probe; items have an owner and a valid trigger | BUILT | condition `requirement-map` |
| US-15-R20, US-15-T11 the conditions hold whichever call reaches the phase change | BUILT | `registerGateExtra`, `advancePhase` in `core/kernel/lifecycle.js`; `advance` is the same call with the ports named |
| US-15-R08 every deliverable has a closing probe a different agent runs | BUILT | `recordDeliverable`, `runDeliverableProbe`; condition `deliverable-probes` at G3 |
| US-15-R09, T15-5 an iteration ends with a retrospective whose outputs are items | BUILT | `startIteration`, `endIteration`, `recordRetrospective`; condition `retrospective` at G3 |
| US-15-R10 status report on the communication plan's period, predicted versus actual | BUILT | `produceStatusReport`, `refreshStatusReports`, `lifecycleStep` (A-MON-1 and A-MON-2) |
| US-15-R19 items past their SLA and capacity over, within or under | BUILT | `itemsLate`, `capacityVariance`, `lifecycle_variance` |
| US-15-R12, T15-4 an out-of-scope request is a scope-gate entry and no item until a recorded decision enables the pack | BUILT | `requestWork`, `decidePack`, `classifyScope` |
| US-15-R21, US-15-T10 one classifier (a superset of the console's table) and the pack host as the enabling decision | BUILT | `SCOPE_RULES`, the `packs` port. PLANNED: `core/src/console.js` `recordAsk` calling `requestWork` |
| US-15-R14 no start above the portfolio cap | BUILT | `startProject`, `lifecycle_capacity` |
| US-15-R15, R16, US-15-T07 risk and issue review, quality metrics, compliance report | BUILT | `monitor.js` (`recordRiskReview`, `evaluateRisks`, `riskReviewDue`, `computeQuality`, `complianceReport`, `monitorStep`) |
| US-15-R18, US-15-T09 closing opens by itself; a closed project is archived once | BUILT | `closing.js` (`openClosing`, `archiveProject`, `archiveClosed`) |
| US-15-R01, R05 outcomes become programs and projects; initiation artifacts are drafted from answers | BUILT | `adopt.js` (`adoptOutcomes`, `draftArtifacts`); the composition root does not yet pass `readback`, `readiness` or `packs`: PLANNED |
| US-15-R22 the system test precedes any project | BUILT in the platform seed (the bootstrap's `qualify` stage and the vision test), see the specification | no test here |
| T15-1, T15-3, T15-6 through this layer | BUILT | asserted in `lifecycle-gates.test.js` |
| Read-only probe | BUILT | `lifecycleProbe` |
| US-15-R15, R16: A-MON-4 risk and issue review, A-MON-6 quality metrics, once per period | BUILT | `reviewRisks`, `qualityMetrics`, `refreshMonitoring`, `lifecycleStep`; each is one `artifacts` row (phase `monitoring`), no new table |
| G2 "every requirement maps to an item and a probe" | NOT COVERED | the kernel checks that items exist and have closing probes, not the mapping |
