<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Trust and autonomy

## Trust is computed

For each pair of surface (repository, runtime, outreach, money, ...) and action class (merge, deploy, send, ...), the system keeps a reliability score from recorded outcomes:

`reliability = (verified + baseline x prior_weight) / (outcomes + prior_weight)`

A pair with no history sits at the baseline, 0.5. In the seed the prior weight is 2: ten verified outcomes in ten gives 0.917; three in eight gives 0.40.

## The ladder

| Rung | The agent may |
|---|---|
| observed | Propose; a reviewer executes and records |
| assisted | Execute in a branch or preview; a reviewer merges |
| delegated | Execute and merge after another agent's review passes |
| autonomous | Execute and merge on green checks; a reviewer audits after |
| self-directed | Also choose its own next items |
| self-modifying | Open changes to its own role file and policy, merged by review |
| self-extending | Propose new roles, surfaces and connectors, merged by review |

A promotion needs at least ten outcomes, reliability of 0.8 or more and no severe outcome (hidden failure or silent drop). A demotion follows reliability below 0.6 or any severe outcome. The tick never changes a rung itself: it opens an item, and a different agent merges the change to the policy file. A rung can never exceed its surface's ceiling, so money, legal, outreach and secrets stay below `execute` however trusted the system becomes.

## One interrupt gate

The system pauses only for an action that is irreversible and identity-bound (spending money, signing, destroying data with no backup, sending outside messages on the principal's behalf, minting a credential only the principal can mint). Before it pauses, it tries to engineer a reversible form: take a backup and verify it, stage behind a default-off flag, deploy to a canary, write a draft instead of sending. What remains becomes a gate card with the default in effect, what the fleet already prepared and a closing probe. The card closes itself when the probe sees the step done, and all other work continues.

## What trust never reaches

The agent harness's permission checks, safety refusals, secret stores, the interrupt gate, consent and opt-out handling, the principal's override and another agent's live claim. These outrank any score.

## Known limits in the seed

Severe outcomes count over all time, so one early silent drop keeps a pair demoted. Idle decay and "no hidden failure for N days" are in the policy but are not yet evaluated.

Specification: [US-SPEC-06](../../specs/US-SPEC-06-trust-and-interrupt-gate.md).
