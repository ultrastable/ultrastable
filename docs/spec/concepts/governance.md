<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Governance: what people decide

- **Direction.** People set objectives. Managers infer priorities from them and from people's revealed choices. Agents may propose a change to an objective but never adopt one.
- **The approval gate.** An agent stops only for steps that are both irreversible and identity-bound. It first tries to make the step reversible.
- **Override.** A person's override always wins and is recorded.
- **Audit.** Every decision, prediction, outcome and trust change is a row that can be reviewed.

## How the rules change

Operating rules are data, versioned like code. A repeated failure pattern (the same signature three times in seven days) or a plain expression of friction creates a proposed amendment. A second model red-teams it, it is replayed against the last week of records, and it is adopted only by a reviewed change, with a version bump. No amendment may weaken the protected limits: harness permission checks, safety refusals, the secret lock, other agents' live claims, outreach consent and opt-out, plane separation, the interrupt gate and the principal's override.

## How code changes

Every change takes one route: a work claim, review (two model families for risky areas such as authentication or migrations), merge on green checks, deploy under a lock, declared probes, and automatic revert if a probe that passed before now fails.

## Status

The amendment loop and the change path are RUNNING in QNFO. The seed carries the policy file and ladder items but not an amendment generator or the review gate.

Specification: [US-SPEC-07](../../specs/US-SPEC-07-governance-and-change-path.md).
