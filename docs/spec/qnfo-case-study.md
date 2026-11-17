<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Case study: QNFO

QNFO is the live demonstration and first customer of Ultrastable: the owner's own fleet of Cloudflare workers, which the design was generalized from. This page says what that shows and, as plainly, what it does not.

## What QNFO is and is not for scope purposes

QNFO also runs outreach, research publishing and similar applications on the same fleet. Those are QNFO's own applications, not Ultrastable's product. Ultrastable's product is the management and self-governance layer described in these documents; the applications are the kind of thing an opt-in Capability Pack would cover ([SCOPE.md](../SCOPE.md)). Where this page cites a number, it comes from QNFO's management and governance ledgers, not from those applications.

## Reading the numbers

Every figure below is owner-reported from QNFO's own ledgers as of 2026-11-10 (unless dated otherwise). QNFO scores itself: there is no outside audit, one installation and one customer. Treat each figure as a statement to re-measure, not as a result. Estimates are marked "estimate". Other figures from QNFO's records exist but are not repeated here because they could not be verified for this page.

## What runs

| Element | Reported state |
|---|---|
| Fleet runtime | About 39 scheduled workers on an edge platform (reported 2026-11-10); an earlier registry count was 80 rows (2026-09-10). Counts differ by date and by definition |
| Managers | One portfolio manager and five program managers on an hourly tick |
| Work ledger | More than 6,600 items passed through (owner-reported) |
| Changes | More than 3,800 merged since 2026-08-10, of which 1,245 in one 7-day window; more than 600 opened by the system's own code loop and more than 400 by a hosted coding agent, coordinated through one claim ledger |
| Predictions | 1,056 scored, 771 matched (73%), by the same system that made them |
| Failure modes | More than 600 with scheduled detectors |
| Decisions and red-teams | More than 2,100 decisions and more than 380 blocker red-teams recorded |
| Tick evidence | More than 7,500 recorded tick steps |
| Autonomy report card | 3.6 of 5 on 2026-09-10, the system's own dated self-assessment |

## What it shows

- The loops close in production: decisions carry predictions, predictions are scored, trust is recomputed hourly from outcomes, and items reopen when they leave the active set without a disposition.
- One claim ledger coordinated more than one kind of executor (the system's own code loop and a hosted coding agent) without collision.
- Probes with automatic revert, a floor guard for model quality, a failure-mode register and a loop breaker were each built in response to a recorded failure.
- Several governance rules are written as data and amended through a reviewed route.

## What went wrong, and was recorded

| Failure | Consequence |
|---|---|
| Nested view evaluated repeatedly in the tick | Store out-of-memory; fixed by a per-tick snapshot |
| Executor reported "scanned 25, executed 0" | 25 items unaccounted for; led to the accounting invariant |
| A deploy ledger with 54 of 76 attempts failed, 51 from two retrying targets | Led to the loop breaker design |
| Two issue stores: 303 open items in one that operations tools did not read | Tools under-reported open work 25-fold; led to the visibility ratio |
| Monitoring roster frozen for 73 of 83 names | Led to census and roster reconciliation |
| Product assertion probes broke on a semicolon in a text literal | A live page read 3 of 7 passing; fixed by a follow-up change recorded the same day |
| Dynamic dispatcher and executor listed as retired in a later consolidation audit | Redundancy between schedulers was demonstrated earlier and is not asserted afterward |

## What it does not show

- It does not show that Ultrastable can be installed by someone else: the seed has not been applied to a fresh account, and QNFO's core is entangled with its applications (a boundary manifest classifies components but entanglement remains in two core workers).
- It does not show the hit rate is good: 73% is an aggregate of the system's own predictions, not calibrated by confidence, and not audited.
- It does not show a non-expert can use it: QNFO's owner is an expert user. The elicitation procedure for non-experts ([US-SPEC-16](../specs/US-SPEC-16-ignorance-and-prompted-recall.md)) is partly RUNNING in QNFO as an owner question queue and is otherwise PLANNED.
- It does not show cost efficiency: no cost-per-task view exists yet.
- It does not show security under adversarial pressure: no outside review has been done.

## Mapping to the specifications

QNFO is RUNNING for most of L2 and parts of L3; the seed is BUILT for L1 except where each specification's status section says otherwise. See [specs/README.md](../specs/README.md).
