<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-23: The closed system (autonomy as self-referential loops)

| Field | Value |
|---|---|
| ID | US-SPEC-23 |
| Title | The closed system |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

This is the definition the other specifications serve. **A system is autonomous if it has self-referential loops and the privilege to close them.** Knowing something and being unable to act on it is useless. Anything that happens outside the system (in a chat thread, in a person's memory, in the private context of a coding agent) is lost, so a conforming system is **closed**: its knowledge, decisions, rules and results live inside it as records.

Terms are defined once, in the principles register (`core/principles/principles.json`, rendered to `docs/GLOSSARY.md`). This specification states what the register and the loops must guarantee.

## 2. Requirements

| ID | Requirement |
|---|---|
| US-23-R01 | **Everything is a record.** A decision, rule, plan, lesson or result MUST be written as a commit, issue, pull request, file or database row in the turn in which it arises. A conversation MUST NOT be the only place it exists. |
| US-23-R02 | **Every loop closes.** Every work item, gate card, claim, prediction, probe and pull request MUST have an owner, a closing probe and, on leaving the active set, a disposition. |
| US-23-R03 | **Closure is performed by code.** The system MUST contain a process that evaluates closing probes and closes items whose probes pass, without a person remembering to do it. |
| US-23-R04 | **Open loops are detected by code and become items.** Anything started or noticed with no owner, closing probe or path to closure MUST be detected, labelled and filed as an item. |
| US-23-R05 | **Loops read loops.** The system MUST be able to read its own backlog, claims, predictions, probes, directives and results, and managers MUST act on them. Loops manage loops, including the loops that manage loops. |
| US-23-R06 | **Privilege to close.** An agent or loop that is responsible for a loop MUST hold the permission to close it within the limits of the interrupt gate. A loop that can detect a defect but is not permitted to act is itself an open loop and MUST be filed. |
| US-23-R07 | **Directives are data.** Every standing instruction from the owner MUST be stored in the principles register with the owner's words, its meaning, its status and either the code that enforces it or an issue that tracks it. A directive with neither is an open loop. |
| US-23-R08 | **Terms are defined once.** The glossary is generated from the register; a document that restates a definition MUST NOT drift from it (the build fails on drift). |
| US-23-R09 | **Knowledge flows back.** What an agent learns while working (a failure, a trick, a constraint, an owner's correction) MUST be turned into a change to a record, a rule, a test or a specification as part of closing the item. |
| US-23-R10 | **External agents are guests.** An external coding agent MAY work inside the system, but its context is not the system's memory. Its work is accepted only as records (commits, issues, pull requests) that the system's own loops can read. |
| US-23-R11 | **Only identity-bound steps leave the system.** The only permitted exits are steps that are both irreversible and identity-bound, and each exit is itself a gate card that closes when its probe sees the step done. |

## 3. Failure modes

| Failure | Control |
|---|---|
| Knowledge stays in a chat or an agent's context | R01, R09, R10 |
| A task is noticed and forgotten | R02, R04 |
| Closure depends on someone's memory | R03 |
| A directive is stated and never enforced | R07 and the register test |
| Documents drift from definitions | R08 |
| A loop sees a problem and is not allowed to act | R06 |

## 4. Conformance tests

| Test | Pass condition |
|---|---|
| T23-1 | An issue with a passing closing probe is closed by the closer with the evidence recorded. |
| T23-2 | An issue with no probe and no linked pull request past its grace period is labelled and reported. |
| T23-3 | An epic files and tracks a child for each of its items and closes when all are closed. |
| T23-4 | Removing the code that a directive names as its enforcer fails the build. |
| T23-5 | Editing the glossary document by hand without the register fails the build. |
| T23-6 | An unenforced directive without a tracking issue fails the build. |

## 5. Reference implementation status

| Capability | Status |
|---|---|
| Loop closer: probes close issues, epics expand and close, open loops labelled (`tools/loop_closer.py`, daily and on push) | BUILT (11 tests) |
| Principles register, generated glossary, enforcer and tracking checks (`core/principles/`) | BUILT (6 tests) |
| Kernel reconcile, failure-mode register and loop breaker; claims; runner | BUILT (`core/kernel`, `core/claims`, `core/runner`) |
| Open-loop linter for any repository | BUILT (`products/gaplint`) |
| Directive enforcement for ignorance elicitation and outbound packs | BUILT (`core/principles/enforcement.js`, test `core/principles/enforcement.test.js`): the register marks D-IGNORANCE-ASSUMED, D-SCOPE-AND-PACKS and D-OUTREACH-AS-LOOPS enforced, and each has a check that runs its enforcer against the checkout (`core/elicit/index.js` ask-card rules; `core/packs/manifest.js` and the no-pack-import check over every `packs/` manifest; loops, charter metrics, caps and suppression of the email, social and video packs) |
