<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Feedback loops

## The tick

Work runs on a heartbeat. In the seed, each tick runs seven guarded steps: reconcile, reap stale claims, probe gate cards, score due predictions, accrue trust, dispatch, check plus share. A failing step files its own priority-0 item and the other steps still run. Each tick writes a four-line report: what happened, what was decided, what is next, what is open. A health route returns 200 only if the last tick completed all its steps.

## Predictions

Before a decision runs, the agent records a checkable prediction (for example `error_rate <= 1 within 24 h`). A scorer reads the real value later and records a hit or a miss. A prediction that names an unknown metric is scored as a miss, so the system cannot avoid scoring by inventing a metric.

## Verified, not merged

An item closes only when a machine-read check shows the change is live and effective. A merge alone is not completion. A fix that exists only in a repository, or is staged but not applied, leaves the finding pending.

## No silent drops

Every item that leaves the active set needs a disposition. The reconcile step reopens any that do not and records a silent drop against trust.

## Trust

Outcomes feed a per-pair trust ledger ([Trust and autonomy](trust-and-autonomy.md)).

## Self-correction

Repeated failures and friction become proposed rule changes, tested against past ticks and adopted by review ([Governance](governance.md)).

## Limits to keep in mind

The scorer is part of the system being scored. Calibration beyond an overall hit rate (binned by stated confidence) is PLANNED. In QNFO the hit rate reported by its own ledger was 73% over 1,056 scored predictions as of 2026-11-10, owner-reported and not independently audited.

Specifications: [US-SPEC-03](../../specs/US-SPEC-03-tick.md), [US-SPEC-05](../../specs/US-SPEC-05-predict-act-verify-score.md).
