<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Plussing

"Plussing" is the practice of building on work instead of only critiquing it: every review must add something.

Automated teams tend to devolve into a queue of fixes. Ultrastable counters that structurally.

1. **Every closed item proposes a plus.** One concrete next step that would make the result better, filed with its expected value and a prediction.
2. **Product managers rank pluses against the roadmap,** so improvement competes for capacity as planned work.
3. **Reserved capacity.** A configurable share of each cycle (default 20%) goes to accepted pluses and is not reallocated to repair when risk rises.
4. **Drift detection.** The share of fix-only cycles is measured. When the plus share of the last 20 closed items falls below half the target, the portfolio manager is handed a rebalance item and the cause is filed as its own item.
5. **Reviews are additive.** A reviewer's output includes at least one plus, not only defects.
6. **Keep or revert.** A plus stores a baseline of its outcome measure and of a separate quality guard at deployment. After a window (default 7 days) it is kept only if the outcome improved by a stated margin and the guard did not worsen; otherwise a revert is filed and the next plus takes a different angle. Every fifth cycle is a simplify pass, to resist accumulating complexity.

## Status

The plus-share check is present in the seed's tick but is not covered by a test. The product registry, keep-or-revert loop and simplify pass are RUNNING in QNFO and not in the seed.

Specification: [US-SPEC-04](../../specs/US-SPEC-04-plus-loop.md).
