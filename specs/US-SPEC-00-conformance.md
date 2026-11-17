<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-00: Conformance, terms and requirement format

| Field | Value |
|---|---|
| ID | US-SPEC-00 |
| Title | Conformance, terms and requirement format |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

This specification fixes the vocabulary, the requirement format, the conformance levels and the test conventions used by US-SPEC-01 to US-SPEC-17. Every other specification is self-contained for its own subsystem but uses the terms defined here.

Related specifications added with this version: US-SPEC-15 (management lifecycle), US-SPEC-16 (ignorance and prompted recall, the elicitation front door of bootstrapping) and US-SPEC-17 (failure modes and remediation). Scope is fixed by `SCOPE.md`; a conforming implementation MUST NOT enable out-of-scope behavior by default (US-00-R09).

## 2. Requirement language

The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. A requirement has an ID of the form `US-<nn>-R<mm>` and a level tag `[L1]`, `[L2]` or `[L3]`. A conformance test has an ID `US-<nn>-T<mm>` and states an observable pass condition and an observable fail condition. A test is run against a running system or against a test harness over a store handle (US-SPEC-14).

## 3. Terms

| Term | Definition |
|---|---|
| Organization | Any entity whose work can be represented as programs, projects, products and work items: a business, a research group, a nonprofit, an individual's affairs. |
| Principal | The human or body of humans for whom the organization operates (owner, board). |
| Agent | A process that reads and writes shared records and may invoke a reasoning component (a model, deterministic rules, or both). |
| Role | A named function with a scope, an instruction file and a decision authority (US-SPEC-02). |
| Virtual staff | The set of agents filling roles. |
| Program | A standing objective with a charter naming a primary metric and zero or more guard metrics. |
| Project | A bounded body of work with a completion state. |
| Product | Something a person uses, with its own usage and quality measures. |
| Work item | A record with at least an identifier, title, owner role, done check, priority and status (US-SPEC-08). |
| Doer line | A machine-readable statement of where and how a change is made, for example `code-task: repo=<repository> path=<file>` plus `code-anchor: <text occurring once in the file>`. |
| Managed system | The systems the organization changes and measures: repositories, services, sites, data stores, channels, processes. |
| Surface | A distinct path to an outcome in the managed system (a service, a repository, a channel). |
| Action class | A category of action on a surface (merge, deploy, apply migration, close item, publish, send). |
| Probe | A declared, machine-executable check of the managed system with an expected result. |
| Verified | Confirmed by a probe or a metric reading taken after the change, as distinct from merged or reported. |
| Tick | One execution of the scheduled procedure; it records what it did (US-SPEC-03). |
| Reversible | Undoable within one cycle, without loss of data that has no backup and without the authority of a party outside the system. |
| Identity-bound | Committing the legal, financial or reputational identity of the principal. |
| Interrupt-eligible | Irreversible and identity-bound, with no reversible form the system can construct. |
| Gate card | The record produced when a step is interrupt-eligible (US-SPEC-06). |
| Silent drop | A work item that leaves the active set without a recorded disposition. |
| Disposition | The recorded reason an item left the active set: done with evidence, superseded, cancelled, or backlogged with a trigger and closing probe. |
| Work claim | A time-limited exclusive hold on an item or path taken by one agent (US-SPEC-08). |
| Plus | One additive, reversible improvement to a product, stated with a prediction before it is made (US-SPEC-04). |
| Surface of record | The store that is the single canonical source for a kind of record. |

## 4. Conformance levels

| Level | Required specifications | Summary |
|---|---|---|
| L1 Seed | 01 (L1 tables), 02, 03 (L1), 04 (L1), 05 (L1), 06 (L1), 08 (L1), 10, 14 | Schema, seven-step tick, claims, gate cards, predictions, trust ledger |
| L2 Managed | L1 plus all `[L2]` requirements | Managerial tick, plus loop, decision log, change path, failure-mode register |
| L3 Fleet | L2 plus all `[L3]` requirements | Fleet runtime, signal boundary, wiring graph, dashboard |

A level claim is valid only if every requirement tagged at or below that level in the cited specifications is met, or is listed in a published deviation list with its reason.

## 5. Normative requirements

- **US-00-R01 [L1]** A conforming implementation MUST declare its conformance level and the version of each specification it follows.
- **US-00-R02 [L1]** A conforming implementation MUST publish a deviation list naming every MUST it does not meet.
- **US-00-R03 [L1]** An implementation MUST NOT use the labels BUILT, RUNNING or PLANNED for its own components in a way that overstates their state: BUILT requires passing tests, RUNNING requires production use.
- **US-00-R04 [L1]** Every probe, metric reading and evidence value reported by an implementation MUST be taken from the system it describes and MUST NOT be constructed.
- **US-00-R05 [L1]** Time values stored by an implementation MUST be comparable as strings in a single format (`YYYY-MM-DD HH:MM:SS`, UTC) wherever a specification compares them.
- **US-00-R06 [L1]** Each specification's identifiers (table names, column names, step names) are normative where marked "MUST"; other names are illustrative and an implementation MAY rename them if it documents a mapping.
- **US-00-R07 [L2]** Numeric values (intervals, thresholds, caps, weights, windows) in these specifications are defaults unless a requirement states otherwise; an implementation MAY use other values, and SHOULD record the values in effect in configuration.
- **US-00-R08 [L1]** Standing limits (US-SPEC-06 section 5) MUST take precedence over any rung, score or policy value.

- **US-00-R09 [L1]** A conforming implementation MUST keep the behaviors that `SCOPE.md` lists as out of scope (business plans, legal filings, advice, outreach, payments, research writing) disabled unless the person enables an opt-in Capability Pack. A pack MUST NOT weaken the interrupt gate or the standing limits (US-SPEC-06).
- **US-00-R10 [L1]** An implementation serving a non-expert MUST obtain the information it needs by the means of US-SPEC-16 and MUST NOT require the person to supply architecture, schema or stack choices.

## 6. Conformance tests

- **US-00-T01** Read the implementation's published level and deviation list. Pass: both exist and name specification versions. Fail: either is absent.
- **US-00-T02** For each component the implementation labels BUILT, locate the named test file and run it. Pass: tests run and pass. Fail: file missing or tests fail.
- **US-00-T03** For each RUNNING label, locate a production ledger row or log from the last 7 days. Pass: found. Fail: none.

- **US-00-T04** Ask the system for a business plan with no pack enabled. Pass: it declines, names the reason and the pack that would cover it. Fail: it produces one.

## 7. Failure modes of this specification

| Failure | Result | Mitigation |
|---|---|---|
| An implementation labels a design as BUILT | Readers trust an unverified feature | US-00-T02 |
| Defaults copied as requirements | Brittle systems | US-00-R07 |
| Self-reported numbers read as audited | False confidence | Legend in the README: RUNNING numbers are self-reported |

## 8. Reference implementation status


- Level definitions: BUILT as a runnable conformance suite. `core/conformance/manifest.json` maps every requirement of US-SPEC-00 to US-SPEC-24 to its level and to the tests that cite it, or lists it as a deviation with the reason; `core/conformance/index.js` builds it, states the declaration (level, specification versions, deviation list: US-00-R01, US-00-R02) and checks it against the tree (a requirement labelled met whose test file is gone or no longer cites it fails: US-00-R03); `core/conformance/cli.js` regenerates it, checks it and runs the test files that prove a level (US-00-T01, US-00-T02). Tests: `core/conformance/conformance.test.js`. Requirements of US-SPEC-16 and US-SPEC-18, which carry no level tag, are counted at L2.
- Declared level of the seed: BUILT as data in `core/conformance/manifest.json`: L1 with a published deviation list. On 2026-11-15, 45 of the 79 L1 requirements were cited by a test and 34 were listed as deviations with the reason "no test in this repository cites this requirement"; a deviation of that kind says the proof is not attached, not that the behavior is absent.
- L1 conformance tests of US-SPEC-01 and US-SPEC-14 with the requirement ids cited (US-01-T01 to T04, US-14-T01, US-14-T04): BUILT in `core/conformance/l1.test.js`.
- Certification by a party other than the implementer: PLANNED. The manifest is produced and checked by the implementation itself; an outside audit needs an auditor.
- US-00-T03 (a production ledger row behind each RUNNING label): PLANNED. Nothing in the seed is labelled RUNNING, and the check needs a production ledger to read.
- The seed in this project meets most L1 requirements; each specification lists the exceptions, and the deviation list above names every requirement without an attached test.
