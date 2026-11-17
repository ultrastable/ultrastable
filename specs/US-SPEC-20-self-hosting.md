<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-20: Self-hosting (Ultrastable runs on itself)

| Field | Value |
|---|---|
| ID | US-SPEC-20 |
| Title | Self-hosting |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

**Ultrastable is built by Ultrastable.** The `ultrastable` organization and its repositories are the first organization the product runs. The same items, claims, reviews, predictions, probes and decisions the product sells are how its own code and specifications are changed. This is the proof that the product works, and it is a rule for everyone who touches the project, whatever tool they use: a coding agent, a chat assistant, an IDE helper, or a person.

This specification defines the self-hosting contract, the ladder by which the project moves from "run by people with agents" to "run by its own heartbeat", the minimum a tool must be able to do, how the project checks itself, and the extra care needed when a system changes its own rules.

## 2. Terms

| Term | Definition |
|---|---|
| Worker | Any agent, tool or person doing work in the organization |
| Contract | The twelve rules in `agents/CONTRACT.md`, identical in every repository |
| Item | A work item: an issue with owner role, done check and closing probe |
| Protected path | A file that defines the rules: agent files, CI workflows, policy, guards, scope, license |
| Spec truth | The property that no status label in the specifications claims more than the code does |
| Stage | A rung of the self-hosting ladder (Section 4) |

## 3. The contract

| ID | Requirement |
|---|---|
| US-20-R01 | Every repository of the organization MUST carry the same contract, rendered into every file an AI tool reads: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/ultrastable.mdc`. They MUST be generated from one source and checked for drift in CI. |
| US-20-R02 | Every change MUST begin as an item and MUST reach `main` through a pull request whose body carries the record: `Item`, `Spec`, `Prediction`, `Evidence`, `Author`, `Reviewer`. |
| US-20-R03 | CI MUST refuse a pull request without that record. Only dependency bots are exempt. |
| US-20-R04 | `Reviewer` MUST differ from `Author`. Where possible the reviewing model differs from the authoring model. |
| US-20-R05 | `Evidence` MUST quote real output. A description is not evidence. |
| US-20-R06 | A specification's status label MAY say BUILT only if it names a file that exists and a test that passes. CI MUST report every line that does not (`tools/spec_truth.py`), and each finding MUST become an item. |
| US-20-R07 | Protected paths MUST require a human reviewer (code ownership), a `Protected-change` line giving the reason, and the label `protected-change`. A worker MUST NOT weaken a guard to make a change pass. If a guard breaches after a change, the change is reverted first. |
| US-20-R08 | One change per protected component at a time, so its effect is attributable. |
| US-20-R09 | The contract MUST NOT depend on any one tool. Where a tool cannot do a step, the contract tells it what to do instead (Section 5). |
| US-20-R10 | The contract MUST state its stage honestly. |

## 4. The ladder

| Stage | Who runs the process | Evidence that it is true |
|---|---|---|
| 0 | A person with any agent, from chat | Work happens; records are patchy |
| 1 | The contract and CI make every change follow the process, whatever the tool | Every merged pull request passes the record check; spec truth reports no false BUILT |
| 2 | The organization's own database holds the items, claims and decisions, mirrored with the issue tracker | Items in the store match open issues |
| 3 | The Worker's tick dispatches work to agents and scores its own predictions | Ticks run on the self-hosted Cloudflare account; every merged pull request traces to a tick |
| 4 | Managers and reviewers are scheduled roles; trust is earned per surface | The trust ledger moves; humans merge less |

| ID | Requirement |
|---|---|
| US-20-R11 | A stage is claimed only when its evidence exists and a probe the stage's author did not write confirms it. |
| US-20-R12 | Moving up a stage MUST NOT remove a lower stage's checks. |
| US-20-R13 | The project MUST publish its current stage, and MUST NOT describe itself as higher. |

## 5. What a tool must do, and what it does when it cannot

| The tool can | It does |
|---|---|
| Only talk (no files, no network) | Produce the artifacts as text for a person to paste: patch, issue text, pull request body; list the records still to be created and by whom; never claim they exist |
| Read and edit files | Make the change on a branch in the working copy; write the item and pull request text to files |
| Use git and the issue tracker | Do everything in the contract |
| Call the organization's own interfaces | Use them for items, claims and decisions as well |

## 6. Measures

| Measure | Definition | Target |
|---|---|---|
| Contract coverage | Merged pull requests with a complete record, divided by merged pull requests | 100% |
| Spec truth | Count of false BUILT lines (`tools/spec_truth.py`) | 0 |
| Execution ratio | Merged pull requests that trace to a tick-dispatched item, divided by merged pull requests | Rises with stage |
| Self-review rate | Pull requests whose reviewer equals the author | 0 |
| Protected-change reviews | Protected-path changes merged without a human review | 0 |

## 7. Failure modes

| Failure | Control |
|---|---|
| The system loosens its own rules | R07: protected paths need a human, guards are never weakened, revert first |
| The record becomes ritual (filled in without meaning) | R05, R04, and the reviewer is a different worker |
| Specifications drift from the code | R06 |
| A new tool ignores the contract | R01: the contract is in every file any tool reads; CI enforces it regardless |
| The project claims more self-hosting than it has | R11, R13 |
| Circular proof (a change verified by a probe it wrote) | R11: the probe is written by someone else |

## 8. Conformance tests

| Test | Pass condition |
|---|---|
| T20-1 | The generated agent files equal the contract in every repository |
| T20-2 | A pull request missing any record field fails CI |
| T20-3 | A pull request whose reviewer equals its author fails CI |
| T20-4 | A change to a protected path without `Protected-change` and the label fails CI |
| T20-5 | A BUILT status line naming a missing file is reported by the spec-truth check |
| T20-6 | The published stage matches the highest stage whose evidence exists |

## 9. Reference implementation status

| Capability | Status |
|---|---|
| The contract, the generated agent files, PR and issue templates, the record check, the spec-truth check, code ownership of protected paths, CI gate | BUILT (`agents/CONTRACT.md`; generator and drift check `tools/sync_agent_files.py`; `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/work-item.yml`; record check `tools/selfhost_check.py`; `tools/spec_truth.py`; `.github/CODEOWNERS`; CI gate `.github/workflows/selfhost.yml`; tests `tests/test_selfhost.py`) |
| Stage 1 in the other repositories (`spec`, `license`, `.github`) | PLANNED: the agent files and templates are rendered into them by `tools/sync_agent_files.py`, but none of the three runs the record check or the spec-truth check in its own CI, so the stage's evidence (every merged pull request passes the record check) does not exist there |
| Stage 2: items, claims and decisions in the organization's own database, mirrored with the issue tracker | BUILT as code (`core/steward/index.js`, `adapters/github/steward.js`, `adapters/github/stage2.js`; tests `core/steward/steward.test.js`, `adapters/github/steward.test.js`, `adapters/github/stage2.test.js`): items are pushed to issues, claims are mirrored as `claim:` comments, decisions as their own issues, issues that exist only on the tracker are adopted into the store, and the stage's evidence is a probe (`stage2Probe`: items in the store match open issues; an unreadable tracker is unknown, never a match). The stage is not claimed: it is not running on the organization's account and US-20-R11 needs a probe its author did not write |
| Stage 3: tick-dispatched work on the self-hosted account | PLANNED: it needs ticks running on the self-hosted Cloudflare account and merged pull requests that trace to them. Built toward it: the tick (`core/src/tick.js`) and the runner that opens draft pull requests (`core/runner/index.js`) |
| Stage 4: scheduled managers and reviewers, earned trust | PLANNED: it needs recorded outcomes on the live account for the trust ledger to move |
