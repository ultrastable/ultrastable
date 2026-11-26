<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/signals: the signal pipeline

The system's own outputs re-enter as inputs. Every record is a signal with an evidential weight; a boundary table decides which worker may read which source (default deny); a revision is accepted only when it strictly shrinks the set of open questions. Written to US-SPEC-12 Part A. A general pattern for any signal source: publication and dissemination are not part of it. Nothing here is RUNNING.

```js
import * as signals from './index.js';
const ctx = { db, now: () => Date.now(), config: { domains: ['research', 'operations'] }, scorers: [modelA, modelB], synthesize, auditor };
await signals.intake(ctx, { source: 'feed', content: '...', weight: 0.7, domain: 'research' });
await signals.step(ctx);                            // re-enter deposited artifacts, then triage
```

Layers: `intake` (L0), `triage` (L1), `permit` and `consume` (L2), `synthesize` (L3), `audit` (L4), `revise` (L5), `proposeFitnessThreshold`, `realize` and `runFitnessExperiment` (L6), `deposit` (L7), `reenter` (L8). Migrations: `migrations/0001_signals.sql`, `migrations/0002_signals_effort.sql` (tables `signals_*`). Tests: `signals.test.js`. Defaults: `accept_at` 0.6, `log_at` 0.3, `disagreement` 0.4, 50 signals per triage pass, re-entry from `published` and `distributed`. The composition root supplies no scorers, synthesizer or auditor, so only re-entry and `realize` run there.

## Requirements

| ID | Status | Where |
|---|---|---|
| US-12-R01 a signal carries a weight; without one it is noise | BUILT | `intake` |
| US-12-R02 boundary consulted before consuming; no row denies | BUILT (reasons `no_signal`, `no_boundary_row`, `not_permitted`, `domain_not_listed`, `cross_domain`) | `consume`; T01 |
| US-12-R03 a denial is an incident and does not stop other work | BUILT | `consume`, `synthesize` |
| US-12-R04 re-entry idempotent on the artifact identifier | BUILT (unique index) | `reenter`; T02 |
| US-12-R05 no recorded U(a): weight 0, status logged | BUILT | `reenter`; T03 |
| US-12-R06 re-entry weight stored, not inferred | BUILT (deposit review `verified`, `clean` or `failed`; failed stores 0) | `deposit`, `reenter` |
| US-12-R07 proper-subset shrink; narrowing logged and rejected | BUILT. Narrowing is detected against the artifact's listed assertions on word stems; a statement never listed as an assertion is not protected | `revise`; T04 |
| US-12-R08 scorecard fallback while the threshold is null | BUILT. The threshold row starts null; a number is written only by a recorded experiment in which fitness beat recency. No numeric value ships | `triage`, `proposeFitnessThreshold` |
| US-12-R18 published artifacts that have not re-entered are reported | BUILT | `status().deposited_not_reentered` |
| US-12-R19 a supplied open-question list may not omit what the auditor still finds open | BUILT | `revise` (reason `audit_disagrees`) |
| US-12-R20 assertion presence judged on word stems | BUILT (English suffixes) | `stem`, `assertionPresent` |
| US-12-R21 the fitness experiment computed from recorded outcomes | BUILT on synthetic outcomes; no real outcomes exist yet | `triage`, `realize`, `runFitnessExperiment` |
| Two-model scorecard | BUILT against a two-scorer port; the model calls themselves are the caller's | `triage` |
| US-12-R09 to R14 | wiring graph: see core/graph | |
