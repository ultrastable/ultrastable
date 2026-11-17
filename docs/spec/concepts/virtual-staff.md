<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Virtual staff

| Role | Owns | Inputs | Outputs |
|---|---|---|---|
| Portfolio manager | Allocation across programs and projects | Objectives, trust ledger, outcome metrics | Priorities, capacity, start and stop decisions |
| Project manager | Delivery of one project | Backlog, dependencies, claims, blockers | Dispatched tasks, unblocked work, status |
| Product manager | Roadmap and user value | Feedback, usage, pluses | Ranked roadmap, accepted pluses, acceptance criteria |
| Staff | Execution | Assigned item with a stop condition | Verified change, evidence, a proposed plus |
| Reviewer | Independent verification | A reported result | Pass or fail with evidence; never the agent that did the work |
| Operations | Running systems | Health signals, incidents | Remediation, failure-mode records |

## Rules that make the structure work

- Every item has an owner, a trigger and a closing check. Nothing leaves the active set without a recorded disposition.
- Managers dispatch; they do not hand work back to people. A step only a person can take (money, legal, credentials) becomes an explicit gate card.
- Roles are configuration: add a role by adding a file and a configuration entry, with no change to the tick.
- A role may be filled by a person; the same records and accounting apply.
- A persona acts only within its listed decision authority and its own lane. A separated plane (for example a private one) cannot be read by another plane's agents, and the denial is enforced by the tool layer.

## In the seed

Six roles ship with instruction files (portfolio manager, project manager, product manager, staff, reviewer, operations). The bootstrapper creates one project manager and one product manager per outcome. At the lowest model budget all model aliases coincide, so reviewer and doer share a model family unless you configure a second provider.

Specification: [US-SPEC-02](../../specs/US-SPEC-02-virtual-staff.md).
