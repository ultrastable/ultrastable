# Invention disclosure (draft)

**Working title:** System and method for operating an organization's portfolio of work with hierarchical virtual management agents, closed-loop outcome verification, computed trust-scoped autonomy, and reserved-capacity improvement ("plussing").

**Inventor:** Rowan Quni-Gudzinas
**Date of this draft:** 2026-11-10

## 1. Problem
Autonomous software agents can execute tasks, but without organizational structure they (a) hand decisions back to people constantly, (b) lose track of work, (c) cannot calibrate how much autonomy to grant, and (d) degrade into reactive bug fixing with no planned improvement.

## 2. Summary of the invention
A computer system that staffs a portfolio of work with virtual agents arranged in an organizational hierarchy (portfolio manager, project managers, product managers, staff agents, independent reviewers), driven by a periodic tick, where:

1. Each action is preceded by a machine-checkable prediction and followed by independent verification; the prediction is later scored against observed metrics.
2. Outcomes update a trust ledger keyed by (surface, action class); computed trust determines the scope of autonomy granted to each agent along a defined ladder.
3. A human approval gate is invoked only for actions classified as both irreversible and identity-bound, after an attempt to construct a reversible alternative.
4. Every completed item produces a proposed improvement ("plus") that is ranked against a roadmap, and a configurable share of capacity is reserved for accepted pluses; a drift detector measures the share of fix-only cycles and triggers rebalancing.
5. Recurring failure patterns and human friction signals generate proposed amendments to the agents' operating rules, which are tested against historical ticks and adopted through review, with version lineage.
6. Every work item carries an owner, a trigger and a closing check; items leaving the active set without a recorded disposition are detected as incidents.

## 3. Detailed description
(Expand from docs/concepts/*. Include data schemas, the priority function, the trust update rule, the ladder transitions, the gate classification, and flowcharts for the tick and for plussing.)

## 4. Embodiments and variations
- Applied to software development, operations, research, marketing or any function.
- Single-org and multi-tenant deployments; serverless (Cloudflare) and other runtimes.
- Roles defined by configuration so an org chart maps onto agents.

## 5. Reduction to practice
Running in the QNFO fleet on Cloudflare since (date). See evidence-log.md.

## 6. Candidate claim directions (for counsel)
- Method: hierarchical virtual management + prediction/verification + trust-scoped autonomy.
- Method: reserved-capacity improvement with fix-only drift detection (plussing).
- Method: irreversible-and-identity-bound gating with reversible-path construction.
- System and computer-readable-medium versions of each.
