<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Security and trust

This is a design summary, not a certification. No third-party audit, penetration test or compliance certification exists. Labels: **BUILT**, **RUNNING** (in QNFO), **PLANNED**.

## Threat model in one paragraph

Ultrastable runs agents that can change code and spend money. The risks are an agent acting beyond its authority, a silent failure, leaked credentials, and an operator unable to see what happened. The design answers with authority computed from verified outcomes, one narrow interrupt gate, and ledgers for everything.

| Concern | Control | Status |
|---|---|---|
| Agent exceeds authority | Autonomy per (surface, action class) from verified outcomes; widening only by reviewed change; no rung reaches secrets, the gate or the standing limits | BUILT in policy and ledger; RUNNING in QNFO |
| Irreversible actions | Interrupt gate: pause only for irreversible and identity-bound steps; open card with default, preparer and closing probe | BUILT |
| Money, legal, outreach, secrets | Surface ceilings below `execute`, enforced by the policy validator | BUILT |
| Policy and harness drift | Every gated shell-reachable action must have a matching deny rule; a test fails otherwise | BUILT |
| Bad deploy | Declared probes; a probe that passed before and fails after reverts; risky diffs read by two model families | RUNNING in QNFO; PLANNED for the seed |
| Silent failure | Reconcile reopens any item with no disposition and records a silent drop against trust | BUILT, tested |
| Tick crash | Each step guarded; a failing step files its own priority-0 item; other steps still run | BUILT, tested |
| Secrets | The tick sees only that a secret exists, never its value; no secrets in the repository; a test plants a value and searches every output | BUILT, tested |
| Scheduler endpoint abuse (Cloud Run skeleton) | `/tick` refuses calls without a token; token compared in constant time (`timingSafeEqual`) | Code present in `platform/adapters/gcp/server.js`; its tests failed on a Windows path error in the 2026-11-11 check and were not re-run elsewhere |
| Human override | Always wins, always recorded | BUILT in policy |
| Audit | Every decision, prediction, outcome and trust change is a row | BUILT (seed tables); RUNNING in QNFO (decision log) |
| Prompt-based lane breach | Plane separation enforced by the tool layer from the requester's identity | RUNNING in QNFO |
| Tenancy and data residency | Per-tenant isolation not built; one organization per deployment | PLANNED |
| Certifications, pen test | None | PLANNED |

## Standing limits

These outrank any trust score: the agent harness's permission checks, classifier refusals, the secret lock, consent and opt-out handling for any outreach, the principal's override, and other agents' live claims. A refusal is recorded with its reason; the same action is never resubmitted in different words to pass the same check.

## Known weaknesses

- SQLite on an object-store volume is single-writer; the Cloud Run skeleton pins one instance.
- The seed has no review gate, no probes with revert, and no model executor; those are RUNNING in QNFO only.
- Seed claims have no token or fence, and nothing renews a claim's heartbeat; a stalled holder could still write after expiry in a system that shares no other control.
- No outside review of the policy or code. Trust numbers are self-scored.
- Severe outcomes count over all time, so a pair can stay demoted after one early failure.
- No dashboard or command-line authentication is built.

## Reporting a vulnerability

No security contact is published yet. `SECURITY.md` is PLANNED.

Specifications: [US-SPEC-06](../specs/US-SPEC-06-trust-and-interrupt-gate.md), [US-SPEC-07](../specs/US-SPEC-07-governance-and-change-path.md), [US-SPEC-08](../specs/US-SPEC-08-work-claims-and-reconciliation.md).
