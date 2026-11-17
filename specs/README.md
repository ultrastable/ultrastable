<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Ultrastable Architectural Specifications

Version 0.1.0 (draft), 2026-11-11.

These documents specify the architecture of Ultrastable, an autonomous development platform: a virtual organization of managers and staff that runs a portfolio of work on a heartbeat, predicts and scores its own decisions, earns autonomy from recorded outcomes, and stops only for steps that cannot be undone. The specifications are source-available and double as a dated public record of the design as of 2026-11-11.

## Index

| ID | Title | Levels |
|---|---|---|
| [US-SPEC-00](US-SPEC-00-conformance.md) | Conformance, terms and requirement format | all |
| [US-SPEC-01](US-SPEC-01-data-model.md) | Data model | L1, L2 |
| [US-SPEC-02](US-SPEC-02-virtual-staff.md) | Virtual staff hierarchy and roles | L1, L2 |
| [US-SPEC-03](US-SPEC-03-tick.md) | The tick and its state machine | L1, L2, L3 |
| [US-SPEC-04](US-SPEC-04-plus-loop.md) | Plus loop (protected improvement budget) | L1, L2 |
| [US-SPEC-05](US-SPEC-05-predict-act-verify-score.md) | Predict, act, verify, score | L1, L2 |
| [US-SPEC-06](US-SPEC-06-trust-and-interrupt-gate.md) | Trust ledger, autonomy ladder, interrupt gate | L1, L2 |
| [US-SPEC-07](US-SPEC-07-governance-and-change-path.md) | Self-amending governance and canonical change path | L2, L3 |
| [US-SPEC-08](US-SPEC-08-work-claims-and-reconciliation.md) | Work items, work claims and reconciliation | L1, L2 |
| [US-SPEC-09](US-SPEC-09-caps-kill-switches-model-ladder.md) | Caps, kill switches, cost-aware model ladder | L2, L3 |
| [US-SPEC-10](US-SPEC-10-kit-and-seed.md) | Organization kit and seed bootstrapping | L1, L2 |
| [US-SPEC-11](US-SPEC-11-fleet-runtime.md) | Fleet runtime | L3 |
| [US-SPEC-12](US-SPEC-12-signal-organism-and-wiring.md) | Signal-organism architecture, wiring graph, orphan detection | L3 |
| [US-SPEC-13](US-SPEC-13-dashboard-sla-report-card.md) | Dashboard, service levels, report cards | L3 |
| [US-SPEC-14](US-SPEC-14-portability-seams.md) | Portability seams and adapters | L1, L3 |
| [US-SPEC-15](US-SPEC-15-management-lifecycle.md) | Management lifecycle (portfolio, program, product, project) | L2 |
| [US-SPEC-16](US-SPEC-16-ignorance-and-prompted-recall.md) | Ignorance and prompted recall (eliciting what a non-expert does not know) | L1, L2 |
| [US-SPEC-17](US-SPEC-17-failure-modes-and-remediation.md) | Failure-mode register, remediation contracts, loop breaker | L2, L3 |
| [US-SPEC-18](US-SPEC-18-guided-console.md) | Guided console (three screens, buttons first, prompt second) | L1, L2 |
| [US-SPEC-19](US-SPEC-19-front-door.md) | Front door and packaging (web launcher, paste-into-agent, developer; Cloudflare Workers only) | L1, L2 |
| [US-SPEC-20](US-SPEC-20-self-hosting.md) | Self-hosting: Ultrastable runs on itself, for any tool | L1, L2 |
| [US-SPEC-21](US-SPEC-21-capability-packs.md) | Capability packs, boundaries and the outbound guard | L2, L3 |
| [US-SPEC-22](US-SPEC-22-self-description.md) | Self-description and the claims registry | L2 |
| [US-SPEC-23](US-SPEC-23-closed-system.md) | The closed system: autonomy as self-referential loops | all |
| [US-SPEC-24](US-SPEC-24-github-substrate-and-cost-control.md) | GitHub as substrate and hard cost control | L2, L3 |
| [US-SPEC-25](US-SPEC-25-tenant-storage.md) | Tenant storage: sandboxed stores, vectors, hard budgets | L2, L3 |

## Status legend

Each specification ends with a Reference implementation status section using these labels, and nothing else:

| Label | Meaning |
|---|---|
| BUILT | Code exists with passing tests, and the file is named. Verified against the code on 2026-11-11 unless stated. |
| RUNNING | In production in QNFO, the first and so far only installation. Numbers are self-reported by that system and have no outside audit. |
| PLANNED | Designed here, not built. |

A feature may carry more than one label (for example BUILT and RUNNING). Where a document says "described, not evidenced", treat the feature as PLANNED.

## Conformance levels

| Level | Name | What it means |
|---|---|---|
| L1 | Seed | The portable core: schema, seven-step tick, claims with expiry, gate cards, predictions, trust ledger with promotion items. Matches the seed in this project. |
| L2 | Managed | L1 plus the managerial layer: risk snapshot, slot allocation, focus, plus loop, decision log, change path with probes and revert, failure-mode register. |
| L3 | Fleet | L2 plus a multi-worker runtime: schedulers, executors, run ledger, signal boundary, wiring graph, dashboard, report cards. |

A conforming implementation states its level and the requirements it does not meet. Requirement tags `[L1]`, `[L2]`, `[L3]` show the lowest level at which a requirement applies. See [US-SPEC-00](US-SPEC-00-conformance.md).

## How to cite

Cite as `US-SPEC-<nn> v<version>, <section>` and a requirement as `US-<nn>-R<mm>`, for example "US-06-R04 (US-SPEC-06 v0.1.0)". Requirement IDs are stable: a requirement is never renumbered or reused. A removed requirement keeps its ID with the text "Withdrawn in <version>". Each file carries its version and date in its header block. Because the repository history records every revision, a citation of a version and date identifies exact text.

## Reading order

Scope is fixed by [../SCOPE.md](../SCOPE.md): Ultrastable manages the delivery of what a person asked for and writes its own specifications; business planning, legal filing, marketing and similar work are out of scope except as opt-in Capability Packs. Start with US-SPEC-00 and US-SPEC-03. The tick is the spine; trust (06), claims (08) and the kit (10) explain what the tick touches. User documentation is in [../docs/](../docs/README.md).
