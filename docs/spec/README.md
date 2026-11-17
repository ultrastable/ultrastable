<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Ultrastable documentation

Ultrastable is an autonomous development platform: a virtual organization of managers and staff that runs a portfolio of work, checks its own decisions against what actually happened, earns wider autonomy from a verified track record, and stops only for steps that cannot be undone.

Status words used throughout, matching the [specifications](../specs/README.md): **BUILT** (code with passing tests), **RUNNING** (in production in QNFO), **PLANNED** (designed, not built).

## Start here

| Read | When |
|---|---|
| [Overview](overview.md) | You want the whole idea in ten minutes |
| [Getting started](getting-started.md) | You want to go from an idea file to a running organization |
| [Concepts](concepts/overview.md) | You want one idea at a time |
| [Security](security.md) | You are deciding whether to trust it |
| [GitHub free organization](github-free-org.md) | You want to know what GitHub gives for free, what changes when repos go public, and what to switch on |
| [QNFO case study](qnfo-case-study.md) | You want to see it running, honestly |
| [Specifications](../specs/README.md) | You want the precise, citable requirements |

## Concepts

[Overview](concepts/overview.md), [Virtual staff](concepts/virtual-staff.md), [Feedback loops](concepts/feedback-loops.md), [Plussing](concepts/plussing.md), [Trust and autonomy](concepts/trust-and-autonomy.md), [Governance](concepts/governance.md), [Work claims](concepts/work-claims.md).

## What exists today

One installation runs the design in production: QNFO, the owner's own fleet. A seed repository turns an idea file into a planned organization and a tested tick, but has not yet been applied to a fresh cloud account. There is no outside customer, no outside audit and no product dashboard yet. Details are in [Getting started](getting-started.md) and the [case study](qnfo-case-study.md).

## Platform and packaging

- [Why Ultrastable runs on Cloudflare Workers](why-cloudflare.md): the reasons, the comparison, the limits, the live trial.
- [System and bootstrapping requirements](system-requirements.md): what a person needs, what it costs, what the system needs.
- [US-SPEC-19: Front door and packaging](../specs/US-SPEC-19-front-door.md): the three ways in.
