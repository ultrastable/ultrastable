# 05 Plussing

## Purpose
Keep a protected share of capacity for improvement so work does not devolve into repair.

## Concepts
Every closed item proposes one **plus**: a concrete improvement with an expected value. A configurable share of capacity (`capacity.plus_share`, default 20%, `seed/ultrastable.json`) goes to accepted pluses. Each product has a plus register: last improvement, in-flight change, rest time, usage and a quality measure.

## Procedure
1. The product manager picks the product by last-improvement time (one in flight), weighted by usage, and generates one additive change with a prediction from evidence.
2. The change runs through the change path (spec 07). At verified deploy a baseline of the target metric and a guard metric is stored.
3. After the review window (default 7 days): keep if the target improved materially and the guard holds; otherwise open a revert item. Missing or stale data counts as not improved.
4. A kept change may seed the next. Three consecutive misses rest the product (default 7 days). Every fourth change is a simplification. If usage is unmeasured, the first change adds measurement.
5. **Drift detector**: the share of fix-only cycles is measured; when it crowds out plus capacity, the portfolio manager rebalances and files the cause.
6. A weekly digest replaces per-change notification.

## Invariants
Reducing the reserved share requires a config record with an expiry. A plus MUST improve specified behavior and MUST NOT add a new product category (spec 00).

## Reference implementation
`seed/worker/src/tick.js` `check_plus_share`; `platform/core/ultrastable/engine.py` (`plus_slots`); QNFO SQL in `platform/cloudflare-reference/` (plus ledger, outcome checks).

## Status
BUILT portable (share check); full loop RUNNING in QNFO.
