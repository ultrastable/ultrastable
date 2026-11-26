<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-02: Virtual staff hierarchy and roles

| Field | Value |
|---|---|
| ID | US-SPEC-02 |
| Title | Virtual staff hierarchy and roles |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Ultrastable staffs an organization with virtual managers and staff, each owning one level of the work, as a real organization is staffed. This specification defines the roles, what each may do (its decision authority), how roles are separated into lanes, and how a role may be filled by a person.

## 2. Terms

| Term | Definition |
|---|---|
| Persona | A role together with a record defining its scope, charter and decision authority. |
| Decision authority | The enumerated set of record operations a persona may perform. |
| Lane | A boundary within which a persona acts and outside which it neither writes nor reads. |
| Brief | A plain-language record of what a persona did and decided on a tick. |
| Plane | A separated body of state with its own personas (for example an organization plane and a private plane). |
| Manager register | The one list of the managers a system runs, each with a tick interval, a core flag and an optional off switch with a reason. |
| Hire | Create the `roles` row of a manager the register switches on. |

## 3. Hierarchy

```mermaid
flowchart TD
  P[Principal: sets objectives, takes identity-bound steps]
  PM[Portfolio manager: allocates capacity across programs]
  PG[Program managers: own program charters]
  PJ[Project managers: milestones, dependencies, completion]
  PD[Product managers: products and the plus loop]
  ST[Specialist staff: finance, comms, operations, research, legal intake]
  RV[Reviewers and quality agents]
  EX[Executors: do the work]
  AU[Auditor and calibrator: scores predictions, maintains trust]
  P --> PM --> PG --> PJ
  PG --> PD
  PJ --> EX
  PD --> EX
  ST --> EX
  EX --> RV
  RV --> AU
  AU --> PM
```

| Role | Owns | Outputs |
|---|---|---|
| Portfolio manager | Allocation of focus slots across programs | Risk-based allocation, escalate or constrain verdicts |
| Program manager | One program charter | Focus set, priority operations, originated work |
| Project manager | Delivery of one project | Dispatch, unblocking, status |
| Product manager | One product and its plus loop | Pluses, keep or revert decisions |
| Staff | Execution of an assigned item | Verified change, evidence, a proposed plus |
| Reviewer | Independent verification | Pass or fail with evidence; never the author of the change |
| Operations | Running systems | Remediation, failure-mode records |
| Auditor and calibrator | Predictions and trust | Scored predictions, ledger updates |

## 4. Normative requirements

- **US-02-R01 [L1]** An implementation MUST define each role as a record naming at least its role, scope and instruction source (a file or prompt), and MUST list the roles in the `roles` table with a tick interval and model.
- **US-02-R02 [L1]** A role instance MUST be dispatched an item only when the item's `owner_role` equals the instance's role (US-SPEC-03).
- **US-02-R03 [L1]** A reviewer MUST be a different agent from the doer of the item it reviews. A reviewer SHOULD run on a different model family from the doer when two families are available.
- **US-02-R04 [L1]** Roles MUST be configuration. Adding a role MUST NOT require changing the tick procedure.
- **US-02-R05 [L2]** A persona's decision authority MUST be an enumerated list, and the managerial tick MUST apply only the operations listed for the persona performing it.
- **US-02-R06 [L2]** Every operation a persona performs MUST be recorded with its identifier, the item, the from value, the to value and its evidence, and MUST be reversible by recording the reverse.
- **US-02-R07 [L2]** A persona MUST write one brief per tick it runs.
- **US-02-R08 [L2]** A program manager MAY promote, restore, close with evidence, supersede and assign a doer within its own program only. A portfolio manager MAY demote machine-filed items across programs.
- **US-02-R09 [L2]** A persona of a separated plane MUST originate no roadmap items in another plane and MUST be denied read access to another plane's stores. The denial MUST be enforced by the tool layer from the requester's identity, not only by prompt text.
- **US-02-R10 [L2]** Control-plane files (the tick, policy, governance and permission configuration) MUST NOT be originated by managers. They change only by a reviewed change under a claim (US-SPEC-07).
- **US-02-R11 [L1]** Any role MAY be filled by a person. The same records, predictions, briefs and trust accounting MUST then apply to that person's decisions.
- **US-02-R12 [L1]** Every role instruction file MUST include a "never" list that names at least: acting on another agent's live claim, handling secret values, and reviewing one's own work.
- **US-02-R13 [L1]** Which managers a system runs MUST be one register carried by the system. Every manager in it is on unless a switch turns it off, a switch MUST carry a reason, and a manager marked core MUST NOT be switched off; a refused switch leaves the manager on and is reported.
- **US-02-R14 [L1]** On every tick, including a tick held lean by a cost level, the implementation MUST hire each manager that is on and has no `roles` row. Dispatch MUST skip a manager that is off. Switching a manager off MUST NOT delete its rows or history.
- **US-02-R15 [L1]** An event addressed to a role MAY wake that role out of turn; the woken role MUST still obey its work-in-progress cap and the rule of R02.

## 5. Behavior

A role instance is a row plus an instruction file. On each tick where `tick_number % tick_every = 0`, the dispatcher offers it one ready item for its role (US-SPEC-03). The instance claims the item, acts, records an outcome and a prediction, and hands to a reviewer. Managers differ from staff only in what they own: allocation, ranking and origination instead of execution.

### Manager register (seed)

The seed carries one register of 18 managers, each with an instruction file of the same name. Nine are core (portfolio, program, project and product managers, staff, reviewer, operations, org designer and infrastructure manager) and cannot be switched off; the others (funding, outreach, research publishing, marketing, legal and IP, customer success, design, UI and UX) are on by default and a deployment switches one off by data with a reason. The tick's reconcile step hires from the register, so a manager added to the register after a system booted starts on the next tick with no migration and no person, and a system that booted with part of the team is brought to the full register by one tick. A hired row's `model` is a tier label copied from a comparable row; what actually ran is recorded on the dispatch (US-SPEC-01 section 4.1).

### Decision authority example

| Persona | May | May not |
|---|---|---|
| Program manager | Promote a focus item from medium to high; close a trigger-filed item when its metric is back on target; supersede an older duplicate; assign a doer | Touch another program's items; edit tick or policy files |
| Portfolio manager | Allocate slots; demote a machine-filed critical item older than 24 h with no doer | Close items with evidence |
| Reviewer | Approve or hold a change | Author the change it reviews |

## 6. Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Persona deletes another persona's rows | Lost priority scores | US-01-R07, US-02-R06 |
| Self-review | Defects pass unseen | US-02-R03 |
| Prompt-only lane separation | A crafted prompt reads another plane | US-02-R09 enforced by tool layer |
| All aliases map to one model at the lowest budget | Reviewer and doer share a family | Deploy-time check (US-SPEC-14), tier rules (US-SPEC-10) |
| A role file exists and no role row does | A title with no loop: its items are never dispatched | Hire from the register every tick (R14) |
| A deployment deletes a manager it does not need | History lost, and no reason recorded | Off switch with a reason; rows kept (R13, R14) |

## 7. Conformance tests

- **US-02-T01** Dispatch with an item owned by `portfolio-manager` and only a `staff` instance due. Pass: not dispatched to staff. Fail: staff claims it.
- **US-02-T02** Add a role row and an instruction file; run a tick. Pass: the role receives dispatches with no code change. Fail: code change needed.
- **US-02-T03** Ask a private-plane persona's tool layer for a query over organization-plane item text. Pass: denied. Fail: rows returned.
- **US-02-T04** Inspect a reviewer assignment where two model families exist. Pass: reviewer family differs from doer. Fail: same family.
- **US-02-T05** Boot a store with only part of the register hired and run one tick. Pass: every manager that is on has a `roles` row, and a second tick hires nothing. Fail: a manager is missing or duplicated.
- **US-02-T06** Switch a non-core manager off with a reason and a core manager off, and run a tick. Pass: the first is not hired and, if a row exists, is kept and not dispatched; the second stays on and the refusal is reported. Fail: otherwise.

## 8. Reference implementation status

Paths that start with `core/` are in the `workers/` directory; `agents/`, `bootstrap/` and `tests/` exist in both `workers/` and `seed/`; paths that start with `seed/` are from the repository root.

- Roles as data: BUILT. Each role has an instruction file in `agents/roles/` (18 in `seed/agents/roles/`) and is configured in `ultrastable.json`; instances are rows in `roles` created by the bootstrapper (`bootstrap/bootstrap.py`, tests in `tests/test_seed.py`). The dispatchers in `core/src/tick.js` and `seed/worker/src/tick.js` (`dispatch`) filter by `owner_role`; US-02-T01 and US-02-T02 are asserted in `core/staff/staff.test.js`.
- Manager register, hire and off switch (US-02-R13, R14, US-02-T05, US-02-T06): BUILT in `seed/autonomy/managers.json` and `seed/worker/src/managers.js` (`roster`, `hireStep`, `isOff`), called from the reconcile and dispatch steps of `seed/worker/src/tick.js`; tests in `seed/worker/test/managers.test.js` ("a system that booted with part of the team is brought to the full register by one tick, and stays there", "a deployment switches a manager off by data: it is not hired, an existing row is kept and not dispatched", "safe defaults: a core manager cannot be switched off and an off switch needs a reason").
- Waking a role out of turn (US-02-R15): BUILT in `seed/worker/src/tick.js` (`dispatch` reads `wake`) and the signed webhook route of `seed/worker/src/index.js`, test "US-02-R15: a role that is not due is dispatched when an event wakes it, takes only its own item, and stays under its cap" in `seed/worker/test/tick.test.js`. The route wakes no extra tick while the free-allowance level is not `ok`; the scheduled tick still takes the item.
- Reviewer-differs-from-doer: BUILT as tier selection in the bootstrapper (`bootstrap/bootstrap.py`) and as a check at review time in `core/kernel/lifecycle.js` (`reviewArtifact` refuses the same agent, and the same model family when both are known; `core/kernel/lifecycle.test.js`). At the lowest budget tier all aliases coincide, so the family differs only if a second provider is configured (a known limit of the seed).
- Decision authority lists, persona actions, briefs and tool-layer lane enforcement (US-02-R05 to R10, US-02-T03): BUILT as a module in `core/staff/index.js` with `core/staff/migrations/0001_staff.sql`, tests in `core/staff/staff.test.js`. A persona is a row with an enumerated authority; `act` applies only listed operations, records each with its from value, to value and evidence, and reverses by recording the reverse; `items` and `readStore` refuse another plane from the persona row, not from an argument; `writeBrief` keeps one brief per persona per tick; control-plane paths are refused. Limits: the kernel's slot allocation runs by rule and is logged as the portfolio persona's operation, not gated by its list; the lane holds for callers of the tool layer, so a runtime must hand agents that layer and not the store handle. RUNNING in QNFO (one portfolio manager and five program managers on an hourly tick).
- Starting the staff step in the composition root, on by default: BUILT in `core/org/buildout.js`, test "issue #201: every build-out step is in extraSteps, runs on by default, and an off switch removes its work" in `core/org/org.test.js`.
- Persona rows seeded by the bootstrapper, and the staff step seen running on a deployed account: PLANNED. The seed tick dispatches by role row and does not read persona authority lists.
- Roles filled by people (US-02-R11): BUILT for the records in `core/staff/index.js` (`filled_by: 'person'`: the same action row, prediction, brief and trust outcome; the tick never acts for a person), tests in `core/staff/staff.test.js`.
- A "never" list in every role file (US-02-R12): PLANNED. The three rules are stated once in the operating agreement every role loads (`agents/AGENTS.md`: a live claim held by another agent is theirs, never handle secret values, never review your own work), and most role files carry a "Never" section of their own; no role file names all three and no check reads them. Work item `Q-SPEC-02-R12-never-lists`.
- A console screen through which a person performs a role's operations: PLANNED. The tool layer is the interface it would call.
