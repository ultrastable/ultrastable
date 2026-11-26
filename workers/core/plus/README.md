<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/plus: the plus loop

Implements `US-SPEC-04`: a reserved share of capacity, a product registry, one plus at a time per product with a prediction and a separate guard, keep or revert on measured evidence, a simplify pass every fifth cycle, rest after three misses, a weekly digest. It uses the seed tables `items` and `gate_cards` only.

```js
import { registerProduct, capacity, plusStep } from './index.js';
await registerProduct(db, { product: 'desk', host: 'desk.example', program: 'REACH', usage_metric: 'requests_per_day', quality_measure: 'error_page_rate' });
const { plus_slots } = await capacity(db, { T: 25, now, config: config.plus });      // pass as config.kernel.plus_slots
await runTick(db, { config, extraSteps: [plusStep({ reader, propose })] });
```

Ports: `db`, `now`, `config.plus` (see `DEFAULTS`), `reader({ product, host, usage_metric }) -> { value, window_h, includes_machine }` (`readers.js`: a first-party reader over the system's own hits, a platform-analytics reader behind a fetch port, and `composeReaders`), `propose({ product, kind, evidence }) -> fields of proposePlus` (`propose.js`: the generator over a model port), `adopt() -> [{ product, host, program }]` (products from the host's own records), `sources` (evidence sources). All are optional: with no reader, readings arrive through `recordReading`; with no proposer, writing the plus is filed as a work item for the product manager. The kernel's allocation takes `config.kernel.plus_slots` off before it reads risk; build that config with `plusSlotsConfig(db, { config, now })`. Migration: `core/plus/migrations/0001_plus.sql`. The spec's `product_registry` is `plus_product_registry` here (module prefix).

## Requirement status

BUILT means implemented and covered by a passing test in this directory (or the one named). Nothing here is RUNNING.

| Requirement | Status | Where / note |
|---|---|---|
| US-04-R01 configurable reserved share (default 20%) | BUILT | `capacity`, `config.plus.plus_share`, `plusSlotsConfig` (US-04-T07). The composition root applies it in `core/org/index.js` `tick()`: PLANNED |
| US-04-R02, US-04-T01, US-04-T02 plus-share check and rebalance item | BUILT | the seed tick (`check_plus_share`); asserted here. The seed twin has no test of its own |
| US-04-R05 not reallocated to repair; lowered only by a row with an expiry | BUILT | `reduceShare`, `effectiveShare`; `core/kernel/programs.js` takes `config.kernel.plus_slots` off before it reads risk |
| US-04-R06 additive, reversible, single change (except simplify), prediction first | BUILT | `proposePlus` |
| US-04-R07 filed as an ordinary work item with a doer line | BUILT | `proposePlus` (item kind `plus`). Travelling the change path is the runner's part, not this module's |
| US-04-R08 guard separate from the outcome measure, read in the product's direction | BUILT | `registerProduct`, `proposePlus`, `decidePlus` |
| US-04-R09, US-04-T04 missing or stale reading is null, never 0, never a pass | BUILT | `recordReading`, `latestReading`, `decidePlus` |
| US-04-R15, US-04-T05 unmeasured stays shipped with an item through the grace, then is reverted as a miss | BUILT | `decidePlus` (`PLUSMEASURE-<id>`, `unmeasured_grace_h`) |
| US-04-R10, US-04-T03 revert item, `misses_in_row`, different angle, `rest_until` after 3 | BUILT | `decidePlus`, `proposePlus` |
| US-04-R11 every Nth cycle is a simplify pass | BUILT | `cycleKind` |
| US-04-R12 a principal-only step is one gate card, never a question | BUILT | `principalStep` |
| US-04-R13 detector for unmeasured usage and a stale digest | BUILT | `detect` |
| US-04-R14 usage that counts machine requests is labelled | BUILT | `measureUsage`; first-party reader labels human requests |
| US-04-R16, US-04-T06 daily cap counted from the ledger | BUILT | `runCycle` |
| US-04-R17 a kept plus seeds the next proposal | BUILT | `decidePlus`, `proposePlus` |
| US-04-R18 step 404 evidence sources; unavailable sources listed | BUILT | `gatherEvidence`; sections and slow routes also read `usage_section:` and `slow_route:` readings |
| US-04-R19 the generator, checked before filing | BUILT over a model port | `propose.js` (fake model); the first real call is on a deployed account |
| Products from the host's own records | BUILT | `adoptProducts`, `plusStep({ adopt })` |
| Selection order, measurement cycle, weekly digest, read-only probe | BUILT | `selectDue`, `runCycle`, `weeklyDigest`, `plusProbe` |
| US-04-R03 every closed item proposes a plus | NOT COVERED here | built in the platform seed (its criticality step files a next item for each closed item, and its doer files a successor), see the specification |
| US-04-R04 every review proposes a plus | BUILT elsewhere | `core/staff/review.js` (`recordReview`, `reviewsWithoutPlus`) |
| A call of a platform's real analytics API | PLANNED | needs a live account and its token; the reader and its fake-fetch tests are in `readers.js` |
