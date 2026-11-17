<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Ultrastable overview

## One sentence

Ultrastable is an autonomous development platform: a virtual organization of managers and staff that runs a portfolio of work end to end, scores its own decisions, earns wider autonomy from its track record, and stops only for steps that cannot be undone.

The name comes from W. Ross Ashby's *ultrastable system* (1952): a machine that changes its own settings when an essential variable leaves its limits.

## Who it is for

A person who can say what they want and who is not a coder or an engineer, and does not know what they do not know. The user only states what they want. The system works out what it needs to know, asks in plain words with examples and stated defaults ([US-SPEC-16](../specs/US-SPEC-16-ignorance-and-prompted-recall.md)), writes its own specifications, charters and plans from the answers, and manages the delivery to the standard of a professional project office ([US-SPEC-15](../specs/US-SPEC-15-management-lifecycle.md)). Elicitation and self-written specifications are PLANNED for the seed; a question queue for the owner is RUNNING in QNFO.

## What it does not do

Ultrastable manages the building of a working system from a stated want. It does not by default write business plans, financial models or funding applications, draft legal instruments, run marketing or outreach, move money, or write research for you. Those are outside scope unless you switch on an optional Capability Pack, and a pack can never weaken the interrupt gate. See [SCOPE.md](../SCOPE.md).

## The problem

AI coding agents multiply effort, but a person still has to pick the work, check the result and notice drift. The person becomes the bottleneck and the single point of failure. Ultrastable moves those jobs into roles, records and rules, and keeps the person for direction and for the few steps only a person can take.

## Seven parts

1. **Virtual managers and staff.** A portfolio manager allocates capacity, project managers deliver, product managers own roadmap and value, staff execute, reviewers verify, operations runs systems. Roles are configuration. See [Virtual staff](concepts/virtual-staff.md) and [US-SPEC-02](../specs/US-SPEC-02-virtual-staff.md). Role files and tick scheduling: BUILT in the seed; RUNNING in QNFO.
2. **A heartbeat.** One tick, every ten minutes, reconciles state, scores predictions, updates trust and dispatches work, server-side, with every step guarded. See [US-SPEC-03](../specs/US-SPEC-03-tick.md). Seven-step tick: BUILT; RUNNING in QNFO with a larger managerial layer.
3. **Closed feedback loops.** Each decision states a checkable prediction first; a scorer compares it with the outcome; nothing leaves the active set without a recorded disposition. See [Feedback loops](concepts/feedback-loops.md). BUILT (scoring, reconcile); RUNNING.
4. **Plussing.** Improvement is planned work. A reserved share of capacity (default 20%) funds additive, reversible pluses, kept or reverted on measured evidence. See [Plussing](concepts/plussing.md). Plus-share check: code present in the seed, untested; the full loop is RUNNING in QNFO.
5. **Earned-trust autonomy with one interrupt gate.** Trust is computed per surface and action class from verified outcomes and moves along a seven-rung ladder, only through reviewed changes. The system pauses only for steps that are both irreversible and identity-bound, and first tries to make them reversible. See [Trust and autonomy](concepts/trust-and-autonomy.md). BUILT (ledger, ladder items, gate cards); RUNNING.
6. **Self-amending rules.** Repeated failures and friction become proposed rule changes, red-teamed, replayed against past ticks and adopted by review; the policy is versioned like code. See [Governance](concepts/governance.md). RUNNING in QNFO; PLANNED for the seed.
7. **Bootstrapping from an idea.** A person writes one idea file; the seed plans the organization, writes its charter and policy, provisions a runtime and starts the heartbeat. See [Getting started](getting-started.md). BUILT and tested (dry run); the first real provisioning has not been run.

## Surfaces

| Surface | What it is | Status |
|---|---|---|
| Back end | Tick, store, roles, policy; portable core with adapters | Core BUILT; Cloudflare RUNNING; Cloud Run skeleton present and unverified here |
| Seed | Idea to running organization | BUILT and tested offline; apply not yet run |
| Dashboard | Live view of loops, trust ledger, gate cards, predictions | RUNNING in QNFO as a fleet dashboard; product dashboard PLANNED |
| Command line | Bootstrap, status, approve a gate card, run a tick locally | Bootstrapper BUILT; unified command PLANNED |

## What is built, plainly

- RUNNING: one installation (QNFO), one customer (its owner), self-scored.
- BUILT in the seed: bootstrapper (12 Python tests), seven-step tick, schema, policy, role files (9 JavaScript tests). Verified 2026-11-11.
- Not built: multi-tenant packaging, installer, product dashboard, a model-calling executor in the seed, any outside customer, any outside audit.

## Failure modes you should expect

- Self-scored numbers can flatter: the system measures itself. Treat every figure as a statement for you to re-measure.
- Autonomy that is too eager is as much a defect as autonomy that is too timid; both are measured, neither is assumed away.
- One bad early outcome can demote a trust pair for good in the seed, because severe outcomes are counted over all time.
