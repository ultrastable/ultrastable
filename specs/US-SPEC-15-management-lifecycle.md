<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-15: Management lifecycle (portfolio, program, product, project)

| Field | Value |
|---|---|
| ID | US-SPEC-15 |
| Title | Management lifecycle |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

A person who is not a project manager should still get the discipline of one. This specification bakes the whole management lifecycle into the system: what must exist at each phase, who produces it, what proves it is done, and what lets the work move on. It covers predictive (plan-driven), agile (iterative) and hybrid delivery. It is limited to managing **delivery of what the person asked for**. It does not include business planning, funding, legal filing or marketing (see `SCOPE.md`).

Vocabulary follows common professional practice (the five process groups familiar from PMBOK, and agile iteration) but names are the system's own; no external standard is reproduced.

## 2. Terms

| Term | Definition |
|---|---|
| Portfolio | The set of programs and standalone projects the organization runs, with one capacity budget (US-SPEC-04). |
| Program | A standing objective with a charter naming a primary metric and guard metrics. |
| Product | A deliverable that persists and is improved over time. |
| Project | Bounded work with a start, an end and an acceptance test. |
| Phase | One of: Initiating, Planning, Executing, Monitoring and Controlling (M&C), Closing. M&C runs alongside the others. |
| Artifact | A file or record that a phase must produce (Section 5). |
| Phase gate | The check that lets work leave a phase: every required artifact exists, each artifact's done check passes, a different agent has reviewed it. |
| Delivery mode | `predictive`, `agile` or `hybrid` (Section 4). |
| Change request | A proposed change to scope, schedule, cap, charter or an accepted artifact. |

## 3. Levels and owners

| Level | Role (US-SPEC-02) | Owns |
|---|---|---|
| Portfolio | portfolio manager | Allocation of capacity across programs; portfolio register; which work starts. |
| Program | program (product) manager | Charter; primary and guard metrics; roadmap; benefits check. |
| Project | project manager | Delivery of one outcome through the phases below. |
| Staff | doer roles | Producing artifacts and code. |
| Reviewer | reviewer role | Verifying every artifact and result. Never the same agent or model as the doer. |

## 4. Delivery mode (tailoring)

**US-15-R01.** At initiation the project manager MUST set `delivery_mode` and record the reason.

**US-15-R02.** Selection rule (defaults, overridable by a recorded decision):

| Condition | Mode |
|---|---|
| Requirements stable, order of work fixed by dependencies, external acceptance milestone | `predictive` |
| Requirements unclear or likely to change, value found by showing working increments | `agile` |
| Anything else, and the default when the person cannot say | `hybrid`: predictive at portfolio and program level (charter, milestones, caps), agile inside each project (backlog, iterations, review) |

**US-15-R03.** The mode changes cadence and artifact weight only. Every artifact in Section 5 marked REQUIRED exists in every mode; agile projects satisfy them in lighter form (for example a one-page charter, a living backlog in place of a baseline schedule).

## 5. Artifact catalog

Each artifact has an ID, an owner role, a done check and the gate it feeds. "Spec" artifacts are written by the system from the person's answers (US-SPEC-16).

### 5.1 Initiating

| ID | Artifact | REQUIRED content | Owner |
|---|---|---|---|
| A-INI-1 | Idea record | The person's stated want in their own words, verbatim; who it is for; first outcomes; constraints | portfolio manager |
| A-INI-2 | Charter (program or project) | Objective; definition of done; primary metric; guard metrics; capacity and cost cap; authority limits; named manager role | program/project manager |
| A-INI-3 | Stakeholder and user register | Who uses it, who is affected, who may approve, who may be harmed | project manager |
| A-INI-4 | Assumption, constraint and default log | Every assumption and every default taken for the person (US-SPEC-16), with a revert path | project manager |
| A-INI-5 | Initial risk and unknowns register | Known risks, plus the output of the first ignorance audit | project manager |
| A-INI-6 | Delivery-mode decision | Mode and reason (R01) | project manager |

**Gate G1 (initiating exit):** A-INI-1 to 6 exist and are reviewed; the charter's definition of done is a probe a different agent can run; the readiness score of US-SPEC-16 is at least the initiation threshold.

### 5.2 Planning

| ID | Artifact | REQUIRED content | Owner |
|---|---|---|---|
| A-PLN-1 | Scope statement and requirements | What is in; what is out (by reference to `SCOPE.md` and the charter); each requirement testable | product manager |
| A-PLN-2 | Architectural specification | The system's own `US-SPEC`-style spec: interfaces, data, behavior, failure modes, conformance tests | product manager with staff |
| A-PLN-3 | Work breakdown | Every deliverable broken to items with owner role, trigger, done check, closing probe (US-SPEC-08) | project manager |
| A-PLN-4 | Backlog and roadmap | Ordered items; at most five roadmap features per program, each with size, goal, user, success metric, closing probe | product manager |
| A-PLN-5 | Schedule and milestones | Predictive: milestone dates and dependencies. Agile: iteration length and forecast. | project manager |
| A-PLN-6 | Capacity and cost plan | Capacity per role, plus-share (US-SPEC-04), spend cap per period (US-SPEC-09) | portfolio manager |
| A-PLN-7 | Risk register | Each risk: cause, effect, likelihood, impact, response, owner, trigger | project manager |
| A-PLN-8 | Quality plan | Done checks and probes per deliverable; who reviews; test strategy | reviewer |
| A-PLN-9 | Communication plan | What the person is told, how often, in what form (the four-line report, US-SPEC-13) | project manager |
| A-PLN-10 | Change-control plan | What counts as a change; who decides; what is auto-approved within authority | portfolio manager |

**Gate G2 (planning exit):** A-PLN-1 to 10 exist; every requirement maps to at least one item and one probe; every item has an owner role, trigger and closing probe; the person has been shown the read-back of the scope and spec (US-SPEC-16 Section 7).

### 5.3 Executing

Executing produces the deliverables and the evidence. It is where US-SPEC-03 (tick), 04 (plus), 05 (predict, act, verify), 08 (claims) operate.

| ID | Artifact | REQUIRED content | Owner |
|---|---|---|---|
| A-EXE-1 | Deliverables | Code, tests, documents, deployed runtime, each with evidence stored | staff |
| A-EXE-2 | Review record | For every deliverable: reviewer, verdict, evidence (never the doer) | reviewer |
| A-EXE-3 | Decision log | Every decision with prediction, authority used, and revert path | any manager |
| A-EXE-4 | Iteration record (agile, hybrid) | Iteration goal, items taken, items done, demonstration result, retrospective outcome | project manager |

**Iteration cycle (agile, hybrid):** refine backlog, plan the iteration from capacity, build, verify, demonstrate working result to the person or their proxy, retrospective. The retrospective's improvements enter the plus queue (US-SPEC-04); the improvement is not optional.

### 5.4 Monitoring and controlling (continuous)

| ID | Artifact | REQUIRED content | Owner |
|---|---|---|---|
| A-MON-1 | Status report | Four lines: what happened, what was decided, what is next, what is open; plus metric values against targets | project manager |
| A-MON-2 | Variance record | Predicted versus actual for each prediction; items late; capacity over or under | project manager |
| A-MON-3 | Change requests and their disposition | Each: request, effect on scope, schedule and cap, decision, who, when | portfolio/program manager |
| A-MON-4 | Risk and issue review | Register reviewed at least once per period; new risks added; issues have owner and probe | project manager |
| A-MON-5 | Scope-gate entries | Out-of-scope requests held and answered (`SCOPE.md`) | portfolio manager |
| A-MON-6 | Quality metrics | Rework rate, defects escaped, probe pass rate | reviewer |

### 5.5 Closing

| ID | Artifact | REQUIRED content | Owner |
|---|---|---|---|
| A-CLO-1 | Acceptance | The definition-of-done probe run, with evidence; person's acceptance or default-in-effect (US-SPEC-16) | project manager |
| A-CLO-2 | Closeout report | Delivered versus chartered, variance, cost, open items each with an owner | project manager |
| A-CLO-3 | Lessons learned | What to repeat, what to change; each change filed into the plus queue | all roles |
| A-CLO-4 | Handover | How the system is run, by whom, what monitors it, how to roll it back | operations |
| A-CLO-5 | Archive | Records retained; claims released; budgets closed | operations |

**Gate G3 (closing exit):** every chartered outcome is Done, or has a disposition (superseded, dropped with reason, moved to a new item); A-CLO-1 to 5 exist; the project record is archived.

## 6. Normative requirements

| ID | Requirement |
|---|---|
| US-15-R01 | `delivery_mode` set and justified at initiation. |
| US-15-R04 | A project MUST NOT enter Planning until G1 passes, nor Executing until G2 passes, nor close until G3 passes. A gate passes only on evidence a reviewer verified. |
| US-15-R05 | Each artifact MUST exist as a file or record, not as chat. |
| US-15-R06 | Any change to a REQUIRED artifact after its gate is a change request (A-MON-3) with a recorded decision. |
| US-15-R07 | A reviewer MUST differ from the doer by agent and, where the model ladder allows, by model family. |
| US-15-R08 | Every deliverable MUST have a closing probe a different agent can run. |
| US-15-R09 | Every iteration (agile, hybrid) MUST end with a retrospective whose outputs are filed as items. |
| US-15-R10 | The status report MUST be produced at least once per period the communication plan states, and MUST report predicted versus actual. |
| US-15-R11 | An item leaving the active set MUST carry a disposition (US-SPEC-08). |
| US-15-R12 | A request outside `SCOPE.md` MUST create a scope-gate entry and MUST NOT be worked until a recorded decision enables a Capability Pack. |
| US-15-R13 | Planning artifacts MAY be lighter in agile mode but MUST NOT be omitted. |
| US-15-R14 | Portfolio manager MUST NOT start a project that would take total capacity above the portfolio cap. |

## 7. How the lifecycle runs on the tick

The tick (US-SPEC-03) is the heartbeat; the lifecycle is what the heartbeat serves.

| Process group | Tick activity |
|---|---|
| Initiating, Planning | Reconcile finds a project with an unmet gate and files the missing artifact as an item for its owner role. |
| Executing | Dispatch hands ready items to staff within capacity; claims prevent duplication. |
| M&C | Score predictions; probe gate cards; reap stale claims; compute variance; refresh the status report. |
| Closing | When every chartered outcome has a disposition, reconcile opens the closing items. |

## 8. Records

Existing in the reference Worker schema: `items` (work breakdown, backlog), `claims`, `gate_cards`, `predictions`, `outcomes`, `trust_ledger`, `dispatches`, `tick_runs`.

A conforming implementation adds the following (names are normative, columns are minimum):

| Table | Minimum columns |
|---|---|
| `phases` | project_id, phase, entered_at, gate_id, gate_passed_at |
| `artifacts` | id, project_id, phase, kind, path_or_ref, owner_role, reviewed_by, status |
| `change_requests` | id, project_id, summary, effect, decision, decided_by, decided_at, revert_path |
| `risks` | id, project_id, cause, effect, likelihood, impact, response, owner_role, trigger, status |
| `lessons` | id, project_id, text, plus_item_id |

## 9. Failure modes

| Failure | Control |
|---|---|
| Phase theater: artifacts exist but are empty | Gate requires the done check, not file existence; reviewer is a different agent. |
| Process overhead for a tiny project | Mode tailoring (R03); a one-page charter satisfies A-INI-2. |
| Scope creep | R06, R12, change control, scope gate. |
| Planning without the person's knowledge | G2 requires read-back (US-SPEC-16 Section 7). |
| Lessons never applied | A-CLO-3 requires a plus item for each lesson. |

## 10. Conformance tests

| Test | Pass condition |
|---|---|
| T15-1 | A new project cannot be moved to Executing while any A-PLN artifact is missing; the attempt creates items, not an error. |
| T15-2 | A deliverable whose reviewer equals its doer is rejected at the gate. |
| T15-3 | A change to the charter after G1 appears in `change_requests` with a revert path. |
| T15-4 | An out-of-scope request creates an A-MON-5 entry and no item is dispatched. |
| T15-5 | Ending an iteration without a retrospective blocks the next iteration. |
| T15-6 | Closing a project with an open item that has no disposition fails G3. |

## 11. Reference implementation status

| Capability | Status |
|---|---|
| Work items, triggers, done checks, closing probes, dispositions, claims, gate cards, predictions, trust, status in four lines | BUILT (`core/src/tick.js`, `core/migrations/0001_init.sql`, tests in `core/test/tick.test.js`) |
| Charters, program and portfolio managers, roadmap, weekly report, management compliance check | RUNNING in QNFO as documents and workers. Generalized in part in `ultrastable/workers`: program charters with primary and guard metrics in `core/kernel/programs.js`, managers with decision authority in `core/staff/index.js`; the weekly report and the compliance check are not |
| Phase gates G1 to G3, `phases`, `artifacts`, `change_requests`, `risks`, `lessons` tables (R01, R04 to R07, R11, T15-1, T15-2, T15-3, T15-6) | BUILT (`core/kernel/lifecycle.js`, `core/kernel/migrations/0002_lifecycle.sql`, tests in `core/kernel/lifecycle.test.js`). The tick files missing gate artifacts as items |
| Mode tailoring, iteration records, scope gate (R02, R03, R09, R12, R13, T15-4, T15-5) | BUILT (`core/lifecycle-gates/index.js`, `core/lifecycle-gates/migrations/0001_lifecycle_gates.sql`, tests in `core/lifecycle-gates/lifecycle-gates.test.js`). The scope classifier is keyword rules restating `SCOPE.md`; enabling a pack records the decision and does not install the pack |
| Deliverable closing probes, status report with predicted versus actual, portfolio cap, the G1 conditions on the charter probe and the readiness score (R08, R10, R14) | BUILT (`core/lifecycle-gates/index.js`, tests in `core/lifecycle-gates/lifecycle-gates.test.js`). The readiness score is a port served by `core/elicit` |
| Starting the lifecycle step from the composition root, risk review (A-MON-4), quality metrics (A-MON-6), the G2 mapping of every requirement to an item and a probe | `lifecycleStep` BUILT in the list `core/org` runs (`core/org/buildout.js`, `core/org/org.test.js`); risk review and quality metrics PLANNED: the `risks` table has no step that reviews it |
