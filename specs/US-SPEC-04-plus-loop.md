<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-04: Plus loop (protected improvement budget)

| Field | Value |
|---|---|
| ID | US-SPEC-04 |
| Title | Plus loop |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Allocation by risk alone gives no capacity to healthy products: all capacity drains to repair. The plus loop reserves a fixed share of change capacity for pluses, each one additive, reversible and stated with a prediction before it is made, and keeps or reverts it on measured evidence. Improvement becomes planned work instead of a leftover.

## 2. Terms

| Term | Definition |
|---|---|
| Plus | One additive, reversible improvement to a product, with a prediction. |
| Plussing | The loop of selecting, generating, shipping, verifying, keeping or reverting, and seeding the next plus. |
| Plus share | The fraction of recently closed items that are pluses. |
| Guard measure | A separate output-quality measure that must not worsen when the outcome measure rises. |
| Simplify pass | A cycle whose plus removes complexity. |
| Rest | A period during which a product receives no plus after repeated misses. |

## 3. Behavior

```mermaid
flowchart TD
  A[402 select due product] --> B[404 gather evidence without asking the principal]
  B --> C[406 write one plus with a prediction]
  C --> D[408 file as ordinary work item with doer line]
  D --> E[Ship through the change path, store baselines]
  E --> F{410 after window: outcome >= baseline*(1+m) and guard not worse?}
  F -- yes --> G[412 kept: reset misses, seed next plus from this one]
  F -- no --> H[414 file revert item, misses+1, different angle next]
  H --> I{3 misses in a row?}
  I -- yes --> J[rest_until set, review different user or surface]
  G --> A
```

**Selection.** Active products not at rest and with no plus in flight, ordered by `(now - last_plus_at) * (1 + usage_weight) * (1 + friction_count)`. A cycle has kind `measurement` if the product has no usage reading, `simplify` if `pluses_since_simplify >= N_SIMPLIFY - 1` (every fifth cycle by default), otherwise `plus`.

**Evidence gathering** (step 404): usage by section, empty and error states, failing probes, slow routes, feedback, earlier principal asks, owed notes, features of comparable products.

**Keep or revert.** At verified deployment store baselines of the outcome measure and the guard. After a window (default 7 days) re-read both. A missing or stale reading is unmeasured and not a pass. Kept if `outcome_after >= outcome_before * (1 + m)` (default m = 0.05, or a metric-specific minimum) and the guard is not worse by more than a tolerance.

**Worked example.** Usage 1,240 requests per day, guard error-page rate 0.8%. A plus adds a "today" summary, predicting usage +10% in 7 days. After 7 days usage is 1,410 (+13.7%), error rate 0.7%: kept, next plus seeded ("add the two links the summary refers to"). A second plus predicts +5%; after 7 days usage is 1,400 (-0.7%): revert filed, `misses_in_row = 1`.

**Digest.** A weekly row lists pluses shipped, kept and reverted per product. A plus never produces a question to the principal.

**Plus share check (L1).** Over the last 20 done items, if at least 10 exist and the plus share is below half the target (default target 0.2, so below 0.10), open `REBALANCE-<date>` for the portfolio manager at priority 5. Example: 1 plus in 20 is 0.05, which opens it.

## 4. Normative requirements

- **US-04-R01 [L1]** A conforming implementation MUST reserve a configurable share of capacity for pluses (default 20%).
- **US-04-R02 [L1]** The implementation MUST measure the plus share over recently closed items and MUST open a rebalance item for the portfolio manager when the share falls below half the target over at least 10 closed items.
- **US-04-R03 [L1]** Every closed item SHOULD propose one plus, filed with its expected value.
- **US-04-R04 [L1]** Reviews SHOULD be additive: a reviewer's output includes at least one plus, not only defects.
- **US-04-R05 [L2]** The reserved share MUST NOT be reallocated to repair when risk rises. Reducing it MUST require a configuration row with an expiry.
- **US-04-R06 [L2]** A plus MUST be additive, reversible and a single change, except in a simplify cycle. It MUST state a prediction (metric, direction, size) before it is made.
- **US-04-R07 [L2]** Each plus MUST be filed as an ordinary work item with a doer line and travel the canonical change path (US-SPEC-07).
- **US-04-R08 [L2]** A plus MUST have a guard measure separate from its outcome measure.
- **US-04-R09 [L2]** A missing or stale reading MUST be recorded as unmeasured (null), never as 0, and MUST NOT count as a pass.
- **US-04-R10 [L2]** On a miss the implementation MUST file a revert item, increment `misses_in_row`, and make the next plus for the product take a different angle. After 3 consecutive misses it MUST set `rest_until`.
- **US-04-R11 [L2]** Every Nth cycle (default 5) MUST be a simplify pass.
- **US-04-R12 [L2]** A step only the principal can take MUST become one gate card and MUST NOT be a question.
- **US-04-R13 [L2]** A detector SHOULD raise an item when a product's usage is unmeasured or the weekly digest is stale.
- **US-04-R14 [L2]** Where a platform counts machine requests with human ones, the usage measure MUST be labelled as such.

## 5. Data

`product_registry` (product, host, program, usage_metric, usage_value, usage_window, usage_read_at, quality_measure, plus_cadence_h, last_plus_at, rest_until, misses_in_row, pluses_since_simplify, state) and `plus_ledger` (id, product, kind in `plus`, `measurement`, `simplify`, `revert`; title, evidence, predicted_outcome, metric, issue_id, status in `proposed`, `filed`, `shipped`, `kept`, `reverted`; baseline, outcome, created_at, decided_at).

## 6. Failure modes

| Failure | Mitigation |
|---|---|
| Optimizing usage at the expense of quality | Separate guard measure (R08) |
| Accumulating complexity | Simplify pass (R11) |
| Starvation under high risk | Reserved share (R05) |
| No data | Measurement kind and unmeasured-as-null (R09) |
| Fix-only streak | Rebalance item (R02) |

## 7. Conformance tests

- **US-04-T01** Seed 20 done items, 1 of kind `plus`. Run a tick. Pass: one `REBALANCE-<date>` item exists, owner `portfolio-manager`, priority 5. Fail: none.
- **US-04-T02** Seed 9 done items. Pass: no rebalance item (too few).
- **US-04-T03 [L2]** Ship a plus with usage +13.7% and a non-worse guard. Pass: status `kept`, `misses_in_row = 0`. Fail: otherwise.
- **US-04-T04 [L2]** Make the usage reading stale at the window end. Pass: outcome recorded unmeasured, not kept.

## 8. Reference implementation status

- Plus-share check (US-04-R02): BUILT in `core/src/tick.js` (`check_plus_share`), target from `ultrastable.json` (`capacity.plus_share` 0.2). US-04-T01 and US-04-T02 are asserted in `core/plus/plus.test.js`.
- Reserved share, product registry, keep or revert, simplify pass, rest after misses, weekly digest (US-04-R01, R05 to R13, US-04-T03, US-04-T04): BUILT as a module in `core/plus/index.js` with `core/plus/migrations/0001_plus.sql`, tests in `core/plus/plus.test.js`. The share is lowered only by a row with an expiry, and `core/kernel/programs.js` takes the reserved slots off before it reads risk; a plus states its prediction, guard, angle, doer and revert path before it is filed as a work item; baselines are stored at shipping; an unmeasured reading is null and never kept; a miss files a revert item, and three in a row set `rest_until`; every fifth cycle is a simplify pass. The spec's `product_registry` table is named `plus_product_registry` there. RUNNING in QNFO (daily cap of 3 pluses taken from the managers' origination cap).
- The plus step in the composition root (`core/org/buildout.js`, test `core/org/org.test.js` issue #201), on by default: BUILT (`core/org/buildout.js`, `core/org/org.test.js`). A generator that writes the plus: PLANNED. The proposer is a port; without one, writing the plus is filed as a work item for the product manager. Step 404 reads usage, guard, open fix items and earlier outcomes; usage by section, slow routes, feedback and comparable products are not read.
- Usage measurement, the record side (US-04-R09, R14): BUILT in `core/plus/index.js` (`measureUsage`, `recordReading`; a failed read is null, and a count that includes machine requests is labelled), tests in `core/plus/plus.test.js`.
- Usage-measurement from platform analytics: RUNNING in QNFO. In `ultrastable/workers` the reader that calls a platform's analytics is PLANNED: it needs a live account and its credential. The port it would fill is `reader` of `plusStep`.
