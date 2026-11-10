---
title: "PROVISIONAL APPLICATION FOR UNITED STATES PATENT"
subtitle: "Systems and Methods for Operating an Organization Through a Hierarchy of Virtual Manager Agents With Closed Feedback Loops, Scored Predictions, Earned Autonomy, and Evidence-Driven Additive Improvement"
---

**DRAFT FOR REVIEW BY A REGISTERED PATENT PRACTITIONER. NOT LEGAL ADVICE.**
Draft version 4 (expanded), prepared 2026-11-10. Inventor: Rowan [full legal name, city, state and citizenship to be completed on the cover sheet]. Working product name: Ultrastable.

# TITLE OF THE INVENTION

SYSTEMS AND METHODS FOR OPERATING AN ORGANIZATION THROUGH A HIERARCHY OF VIRTUAL MANAGER AGENTS WITH CLOSED FEEDBACK LOOPS, SCORED PREDICTIONS, EARNED AUTONOMY, AND EVIDENCE-DRIVEN ADDITIVE IMPROVEMENT

# CROSS-REFERENCE TO RELATED APPLICATIONS

None. [Practitioner to confirm.]

# FIELD

[0001] The present disclosure relates to computer-implemented systems of autonomous software agents, and more particularly to systems in which agent processes backed by machine-learning models are organized as the staff of an organization (for example, a portfolio manager, program managers, project managers, product managers, reviewers, auditors and specialists), originate, prioritize, dispatch, verify and score work through closed feedback loops recorded in persistent ledgers, and widen or narrow their own scope of autonomous action from measured outcomes.

# BACKGROUND

[0002] Agent processes built on large language models and other machine-learning models can write code, draft documents, analyze data and call external tools. In many arrangements a human selects each task: a person prompts an agent turn by turn, assigns tickets to a coding agent, or authors the workflows that route events to agents. Continuous-integration checks and human reviewers judge each change at the moment it merges.

[0003] Such arrangements leave several technical problems open. The selection of the next unit of work is performed outside the system, so throughput is bounded by a human's capacity to choose, prioritize and review. A change is typically evaluated at merge time rather than by whether the measured state of the managed system moved as intended afterward. Permissions of agents are typically static configuration rather than a function of the recorded reliability of each class of action. When agents are given maintenance responsibility and allocate attention by failure, functioning products receive no allocation, so continuing improvement depends on a human request. The text that governs agents is typically fixed and does not change in response to the agents' own repeated failures. Related failures recur because no component groups them and assigns their cause. Concurrent agents can duplicate or overwrite each other's changes. Items of work can leave a queue without any record of their disposition.

[0004] Human organizations address analogous coordination problems through roles such as portfolio, program, project and product management, review and audit. The present disclosure describes computing systems that implement those functions as agent processes operating on shared data structures, with closed loops that measure and correct their own behavior.

# SUMMARY

[0005] This summary introduces concepts further described below. It does not identify key or essential features and does not limit the claims.

[0006] **Management hierarchy.** In one aspect, persona records associate agent processes with roles in a management hierarchy, a program, at least one metric, and an enumerated set of permitted record operations. On scheduled ticks, a portfolio-manager agent computes a risk value per program and writes an allocation of a bounded number of focus slots, at least partly in proportion to risk. Program-manager agents rank open work items so that items tied to the program's metrics come first, select items within their allocation, and write priority records that an execution queue reads to dispatch work to executor processes. Every operation by a manager agent is recorded with its prior and new value, and each agent is restricted to the operations in its persona record.

[0007] **Plus loop.** In another aspect, a product register is kept separate from the program register, and a fixed share of change capacity is reserved for improving products regardless of program risk. A product-manager agent selects a product, a model-backed agent generates one additive change with a prediction from evidence read from the managed system without human input, the change ships through the ordinary change path, baselines are captured at verified deployment, and after a window the change is kept only if an outcome measure improved past a threshold without regression of a guard measure; otherwise a revert is generated.

[0008] **Earned autonomy.** In another aspect, each decision is stored with a machine-readable prediction that is scored at its due time; a trust ledger keyed by surface and action class computes a trust score from verified outcomes with a prior; the score maps to a rung of an autonomy ladder; and the rung selects the execution path of a proposed action. Before an action is classified as irreversible the system attempts to construct a reversible form of it; only an action that remains irreversible and identity-bound is routed to the human principal, as a card with a default and a closing probe, while all other work continues.

[0009] **Self-amending governance.** In another aspect, a register of output signatures is matched against agent outputs and principal messages; a signature that recurs past a threshold produces an amendment proposal that is replayed against stored records of recent ticks and adopted through a reviewed, versioned change only if it improves the replay and leaves a protected set of limits unchanged.

[0010] **Change path.** In another aspect, changes are applied under a claim with an expiry and a monotonically increasing fence value, risky changes are reviewed by models of two disjoint families with findings retained only when their evidence occurs verbatim in the change, and a deployment is reverted automatically when a declared probe that passed before it fails after it.

[0011] **Organization kit.** In another aspect, an organization-independent core of persona templates, ledgers, tick procedures stored as data, policy and a probe-and-revert path is installed for an organization by supplying a tenant configuration and connecting the organization's systems as probed surfaces, without modifying the core.

[0012] Systems comprising processors and memory, and non-transitory computer-readable media, that perform these methods are also described.

# BRIEF DESCRIPTION OF THE DRAWINGS

[0013] FIG. 1 is a block diagram of a system for operating an organization through virtual staff agents.
FIG. 2 is a block diagram of a virtual staff hierarchy.
FIG. 3 is a flow diagram of a periodic manager tick.
FIG. 4 is a flow diagram of a plus loop.
FIG. 5 is a flow diagram of a predict, act, verify and score loop.
FIG. 6 is a flow diagram of trust-gated autonomy and an interrupt gate.
FIG. 7 is a flow diagram of self-amendment of governing policy.
FIG. 8 is a flow diagram of a recurrence and root-cause loop.
FIG. 9 is a block diagram of an organization-independent core applied to different organizations.
FIG. 10 is a flow diagram of work claims with an expiry and a fencing value.
FIG. 11 is a flow diagram of reconciliation and a principal queue.
FIG. 12 is a flow diagram of a canonical change path.
FIG. 13 is a flow diagram of a cost-aware model ladder.
FIG. 14 is a block diagram of deployment embodiments.
FIG. 15 is a flow diagram of an idea-to-organization bootstrapper.
FIG. 16 is a flow diagram of a recognition-and-redirect pipeline applied to a draft agent output, comprising signature matching, classification of a stop as a false stop or an excluded refusal or interrupt-eligible stop, redirect and re-execution, and recording of a hit.
FIG. 17 is a diagram of a kernel tick with per-step evidence records and of a trust-scope wheel in which an autonomous action yields a verified outcome, a trust deposit and a wider scope.
FIG. 18 is a block diagram of a fleet topology and closed operating loop in which two schedulers start manager ticks that read a work ledger, executors carry out work and deploy, probes verify, a signal store receives records, and a dead-man check and feedback return to the manager ticks.
FIG. 19 is a block diagram of a wiring graph, dashboard data flow and report-card computation in which a wiring sweep feeds a wiring graph store, a graph analyzer combines the graph with a service registry to compute an integration score, and a report-card computation feeds dashboard pages, owner digests and a kaizen loop that causes re-sweeping.
FIG. 20 is a flow diagram of goal authoring and the objective-space lifecycle, showing derivation of candidate goals from signals, routing of objective revisions to a ratification queue, scoring and de-duplication, anchoring to a ratified objective, adoption of derived goals, probation of novel goals, ratification, and retirement with a recorded disposition.
FIG. 21 is a state diagram of a work breakdown structure item, showing backlog, trigger evaluation, blocked, ready, in progress, review, principal queue, closing-probe test, done, superseded or cancelled, and release of dependent items on completion.
FIG. 22 is a flow diagram of a model ladder in which a task class is answered by a deterministic handler, a cache or a model rung chosen by a capability gate, with spend-cap step-down, validation-gated escalation and recording of cost per verified outcome (numerals 2202 to 2224).
FIG. 23 is a flow diagram of a calibration and model-admission pipeline in which a candidate model passes a floor check, a capability canary and a label agreement check against a gate, is admitted to a model task matrix, is monitored for drift, and is demoted or removed on regression (numerals 2302 to 2322).
FIG. 24 is a flow diagram of an audit-and-act procedure in which findings are re-tested by verification documents, wrong findings are superseded by correction or retraction documents, and a map-territory realization gate holds a claimed fix pending until it is observed in the managed system.
FIG. 25 is a flow diagram of a failure mode register with scheduled detectors, a remediation contract, a loop breaker, silent-drop reconciliation of outcome buckets, and roster reconciliation.
FIG. 26 is a block diagram of installation of a seed code base for an organization, showing an idea file, an organization configuration file and an autonomy policy file as tenant configuration, an unmodified portable core, connectors detected by presence only, a staged bootstrapper, the resulting org record, gate cards and seed statements, a runtime with a scheduled heartbeat, a scored first prediction, and product claim probes.
FIG. 27 is a block diagram of a platform-agnostic adapter mapping in which a portable core is connected through an adapter interface of six ports (schedule, store, secrets, model, deploy and health) to an edge embodiment, a cloud-provider embodiment and a container embodiment.
FIG. 28 is a flow diagram of emailed-code login by an allow-listed principal, verification of the session assertion, and execution of an allow-listed command through the console and a control authority.
FIG. 29 is a flow diagram of the lifecycle of an owner task card, including creation, ranking, one-tap fix, delegation to the fleet, default in effect, and closure by a closing probe.

# DETAILED DESCRIPTION

[0014] The following describes illustrative embodiments. Features of one embodiment may be combined with features of others. "May", "can", "in some embodiments" and "for example" indicate optional features. Numerical values (intervals, thresholds, caps, weights, windows) are examples and other values may be used, including values learned from recorded outcomes. "Or" is inclusive. "A" and "an" mean one or more. Reference numerals refer to the drawings.

## 1. Definitions

[0015] "Organization": any entity whose work can be represented as programs, projects, products and work items, including a business or unit, a research group, a nonprofit, a public body, or an individual's affairs.

[0016] "Agent process" or "agent": a process executing on one or more processors that reads and writes shared records and may invoke a reasoning component. A reasoning component may include a machine-learning model (for example a large language model or a decision model), deterministic rules expressed as database queries or code, or both.

[0017] "Virtual staff agent", "virtual manager" or "persona": an agent process together with a persona record defining at least a role, a scope, a charter and a decision authority (an enumerated set of permitted record operations).

[0018] "Principal": the human or body of humans for whom the organization operates, such as an owner or board.

[0019] "Program": a standing objective with a charter that names a primary metric and zero or more guard metrics. "Project": a bounded body of work with a completion state. "Product": something a person uses, having its own usage and quality measures. A product belongs to a program; its improvement is allocated separately from the program's repair work.

[0020] "Work item" or "issue": a record of work having at least an identifier, title, program, priority, status and source, and optionally a doer line, which is a machine-readable statement of where and how a change is to be made (for example `code-task: repo=<repository> path=<file>` and `code-anchor: <text occurring once in the file>`).

[0021] "Managed system": the computing systems and other resources whose state the organization changes and measures, such as code repositories, deployed services, websites, data stores, communication channels or operational processes. "Surface": a distinct path to an outcome within the managed system (for example a service, a repository, a channel or a tool). "Action class": a category of action (for example merge, deploy, apply migration, close issue, publish, send).

[0022] "Probe": a declared, machine-executable check of the managed system (for example an HTTP request and expected content, or a database statement and expected result). "Verified": confirmed by a probe or a metric reading taken after the change, as distinct from merged or reported.

[0023] "Tick": one execution of a scheduled procedure; a tick records each step it performs. "Heartbeat": the continuing sequence of ticks.

[0024] "Reversible": undoable within one cycle without loss of data that has no backup and without the authority of a party outside the system. "Identity-bound": committing the legal, financial or reputational identity of the principal (for example spending the principal's money, signing on the principal's behalf, or acting in the principal's personal accounts). "Interrupt-eligible": irreversible and identity-bound with no reversible form that the system can construct.

[0025] "Plus": one additive, reversible improvement to a product, stated with a prediction before it is made. "Plussing": the loop of selecting, generating, shipping, verifying, keeping or reverting, and seeding pluses.

[0026] "Silent drop": a work item that leaves the active set without a recorded disposition. "False stop": an output of an agent that pauses, asks, offers options, or assigns a next step to the principal when the step was not interrupt-eligible.

## 2. System overview (FIG. 1)

[0027] A system 100 serves a principal 102, who sets objectives and receives digests. A governance layer 104 stores policy, including a protected set of limits, the interrupt gate and the self-amending policy. A virtual staff hierarchy 106 performs management functions. A work ledger 108 holds work items, roadmap entries and claims. A decision and prediction ledger 110 holds decisions and predictions. An executor pool 112 holds executor processes and, optionally, people. Executors change managed systems 116. A verification engine 114 runs probes and reverts regressions. A signal store 118 holds metrics, usage, failures, friction signals and outcomes, and feeds the hierarchy. A trust ledger 120 computes trust from outcomes and feeds the governance layer as scope.

[0028] Computing environment. Embodiments execute on one or more computing devices each having one or more processors, memory, persistent storage and a network interface, including serverless execution environments, containers, virtual machines and physical servers. Agents communicate through shared records in one or more databases and through authenticated network calls. Model-backed reasoning components are invoked through local or remote inference endpoints.

## 3. Data model

[0029] Embodiments store some or all of the following records. Column names are illustrative.

| Record | Example fields |
|---|---|
| `management_personas` | persona_key, role, scope (program or portfolio), charter_text, decision_authority (list of permitted operations), path_a (procedure it runs) |
| `program_charters` | program_code, objective, definition_of_done, primary_metric, guard_metrics, manager_persona |
| `agent_issues` (work items) | id, title, description (with doer line), program_code, priority (critical, high, medium, low), status, source, category, linked_session, created_at, updated_at |
| `issue_triage` | issue_id, owner, triage_state, close_evidence |
| `issue_priority_scores` | issue_id, impact, probability, capability_gain, reach_gain, remediation_cost (each 1 to 5), scored_by, scored_at |
| `program_risk_now` | tick, program_code, risk_score, verdict, quality_index |
| `portfolio_allocations` | tick, program_code, manager_persona, verdict, risk_score, risk_24h, open_issues, slots, decision, reason |
| `program_focus`, `program_focus_log` | program_code, issue_id, tier, has_doer, entered_at; log of enter, exit and closed events |
| `persona_actions` | id, ts, persona_key, kind, issue_id, from_value, to_value, evidence, reverted_at |
| `persona_briefs` | tick, persona_key, brief_text |
| `decision_log` | id, ts, actor, action, reason, predicted_outcome, surfaces_tested, revert_path |
| `decision_predictions` | id, decision_id, kind (metric or issue), subject, op (<, <=, >, >=, =, between, closed), value, value2, due_at, origin (parsed or seeded), scored_at, observed, matched |
| `decision_outcomes` | decision_id, observed_outcome, matched, evidence, actor |
| `trust_ledger` | surface, action_class, ok, fail, trust_score, ladder_position, evidence, refreshed_at (key: surface, action_class) |
| `trust_transitions` | ts, surface, action_class, from_ladder, to_ladder, trust_score, evidence |
| `product_registry` | product, host, worker, program_code, what_for, usage_metric, usage_value, usage_window, usage_read_at, quality_measure, plus_cadence_h, last_plus_at, rest_until, misses_in_row, pluses_since_simplify, state |
| `plus_ledger` | id, product, kind (plus, measurement, simplify, revert), title, evidence, predicted_outcome, metric, issue_id, pr_url, status (proposed, filed, shipped, kept, reverted), baseline, outcome, created_at, decided_at |
| `work_claims` | id, path, intent, holder, issue_id, pr, token, fence, claimed_at, expires_at, released_at, outcome |
| `queue_pulls` | ts, puller, issue_id, via, ref |
| `tick_runs` | tick_id, step, ok, evidence, ts (key: tick_id, step) |
| `failure_modes` | fm_key, failure_mode, root_cause, remediation, detector (query), probe_class, first_seen, issue_id |
| `issue_recurrence_now` | family, reopens_7d, new_7d, reopens_24h, new_24h, program_code |
| `false_stop_register`, `false_stop_phrases`, `false_stop_hits` | pattern_key, pattern, cause_class, detection_heuristic, auto_remediation; phrases per pattern and scope; hits per output |
| `doctrine_proposals` | id, ts, source, signal, proposed_rule, red_team_result, metrics_improved, version, status (proposed, adopted, rejected, superseded) |
| `doctrine_lineage` | version, source, file, adopted_at |
| `human_actions` (principal queue) | id, title, identity_bound_line, default_in_effect, reason, closing_probe, status |
| `ops_config` | key, value (switches such as persona_actions, product_plus, doer_assign, fleet_kill_switch, review gate mode) |
| `metric_registry`, `metric_triggers` | metric, producer, value, refreshed_at; trigger op and threshold, issue filed on breach |
| `model_task_matrix` | task_class, rung, model, cost per unit, validation |

[0030] Database views compute rankings and plans on read (for example `v_program_risk`, `v_portfolio_allocation_plan`, `v_program_focus_candidates`, `v_issue_queue_v2`, `v_product_plus_due`, `v_trust_ledger`, `v_human_action_gate`). Database triggers enforce invariants (for example that each registered metric has a trigger, that a parked task is rerouted rather than queued for the principal, and that a prediction in the parsable form is copied into `decision_predictions`).

## 4. Virtual staff hierarchy (FIG. 2)

[0031] A virtual portfolio manager 202 allocates capacity across programs. Virtual program managers 204a to 204n each own a program charter. Virtual project managers 206 track milestones, dependencies and completion of projects. Virtual product managers 208 own products and the plus loop. Quality and review agents 210 review changes. Specialist staff agents 212 perform functions such as finance, communications, operations, research or legal intake. Executor agents 214 perform the work. An auditor and calibrator agent 216 scores predictions and maintains the trust ledger. Each persona writes a plain-language brief 218 on each tick.

[0032] In one embodiment, a portfolio manager and five program managers (operations, infrastructure, reach, research and personal) are seeded as persona records, with program charters naming each program's primary and guard metrics, and agent prompt records for the model-backed components.

[0033] Decision authority. A persona's operations are enumerated. In one embodiment a program manager may promote, restore, close with evidence, supersede and assign a doer within its program, and the portfolio manager may demote certain machine-filed items across programs. The tick procedure applies only the operations listed for the persona performing it. Rows written to shared tables carry the writer's identifier, and a persona deletes only rows it wrote and inserts without overwriting rows of other writers.

[0034] Lanes. In one embodiment control-plane files and governance files are not originated by managers and change only by a reviewed change under a claim. A persona of a separated plane (for example personal) originates no roadmap items and is denied reads of another plane's stores. In one embodiment the denial is enforced by the tool layer according to the requester's identity (for example, a request whose requester is the personal program manager receives no database-query tool over work-item text), not only by instructions in a prompt.

[0035] Any persona may be filled by a person; the same records, predictions, briefs and trust accounting then apply to that person's decisions.

## 5. Periodic manager tick (FIG. 3)

[0036] At step 302 a tick starts on a schedule (for example hourly at a fixed minute). At step 304 the system computes the risk value, verdict and quality index of each program once and writes them to `program_risk_now`. Later steps read this snapshot. In one embodiment this replaced repeated evaluation of a nested view from several query branches, which had caused the database to fail with an out-of-memory error; reading the snapshot made the allocation step complete (in one measurement the risk view alone ran in 28 ms while the nested plan failed).

[0037] Risk. In one embodiment, risk = 3 x H + 0.3 x O + 15 x G + 2 x S, where H is the number of open high-priority items, O the number of open items, G the number of guard-metric breaches and S the number of stalled projects. The verdict is RED when a guard or the primary metric is in breach, AMBER when H > 0 or S > 0, and GREEN otherwise. The quality index is the percentage of measured metric triggers of the program that are on target.

[0038] At step 306 the portfolio manager allocates a bounded total of focus slots T (for example 25, read from configuration). In one embodiment half of T is divided evenly among programs with open work and half in proportion to each program's share of total risk, with rounding so the total does not exceed T.

[0039] At step 308 the portfolio manager classifies each program: constrain (highest risk); escalate (risk up more than 10 percent in 24 hours, or quality index down 5 points or more in 24 hours; slots raised by half); accelerate (risk down more than 20 percent in 24 hours); maintain (GREEN; one slot); steady; or idle (no open work). One `portfolio_allocations` row is written per program per tick.

[0040] Worked example. Five programs have risks OPS 120, INFRA 40, REACH 20, RSCH 15, PERSONAL 5 (total 200) and T = 25. Even portion: 12 slots, about 2.4 each. Risk portion: 13 slots split 60%, 20%, 10%, 7.5%, 2.5%, that is 7.8, 2.6, 1.3, 0.98, 0.33. After rounding, OPS 10, INFRA 5, REACH 4, RSCH 3, PERSONAL 3 (total 25). OPS is classified constrain. If INFRA's risk rose from 30 to 40 in 24 hours (33 percent), INFRA is classified escalate and its slots are raised to 7, and the excess is removed from the lowest-risk programs so the total stays at 25.

[0041] At step 310 each program manager ranks its open items: tier 0, items tied to the charter's primary metric; tier 1, items tied to a guard metric; tier 2, critical; tier 3, high; tier 4, other; then by priority and age. The top items up to the program's slots form its focus set (`program_focus`, with each enter and exit in `program_focus_log`). For each focus item the manager writes an `issue_priority_scores` row with impact 5, probability 5, gains 5 and 5, and cost 1, so that the execution queue takes it ahead of other items of its tier. When an item leaves focus the manager deletes only rows where scored_by equals its own key.

[0042] Execution queue. In one embodiment the queue view orders open items by (critical first), then (older than one hour first), then by score s = impact x probability x (capability_gain + reach_gain) x (1 / remediation_cost) x trust x (1 + direction), where missing factors take defaults derived from priority, category and the presence of a doer line; trust is the trust score of the surface and action class the item will use (for example code-loop and merge); and direction is the confidence of an inferred-direction row for the item's category (categories in which the principal filed two or more items in the last 7 days). Every pull is recorded in `queue_pulls`. Worked example: a focus item scores 5 x 5 x (5 + 5) x 1 x 0.47 x 1 = 117.5; an unfocused high item with impact 4, probability 3, gains 4 and 1, cost 2, trust 0.5 and direction 0.2 scores 4 x 3 x 5 x 0.5 x 0.5 x 1.2 = 18.

[0043] At step 312 managers perform operations within their authority, each written to `persona_actions` with from_value and to_value:

(a) promote: a focus item at medium or low becomes high; restore: on leaving focus and still high, it returns to its prior priority.

(b) close with evidence: an item filed by a metric trigger closes when the metric's reading is back on target, the reading was refreshed within a window (for example 120 minutes), the item is older than a minimum age (for example 120 minutes), and no remediation contract for it is failing; the reading is stored as close evidence. The metric's own trigger re-files the item if it breaches again, and a reopen trigger links the new filing to the old item.

(c) supersede: an older open item for the same trigger as a newer one closes as superseded by the newer one, after its contracts are superseded.

(d) demote: a critical item filed by a machine loop more than 24 hours ago, with no doer line, no linked session, not filed by a metric trigger and not a primary- or guard-metric focus item, becomes high. Items filed by the principal or by a session are not demoted.

(e) assign doer: for up to N focus items (for example 4, critical first) without a doer for 2 hours, the manager sends a request to a model-backed agent for one target file and anchor. The answer is validated (control-plane paths, governance paths, separated-plane paths and anchors shorter than a minimum are rejected; the anchor occurs exactly once in the target). A valid answer is written as the first lines of the item, so an executor builds it; otherwise a no-fix finding with its reason is recorded, so that the gap is a recorded finding. The same item is not requested again for a period (for example 3 days).

(f) reroute parked tasks: an execution task that an executor parked for a human (for example a large file without an anchor, or a data change without a verifier) is moved to a failed state at creation by a database trigger and handled by the managers once, marked so it is processed once.

[0044] At step 314 managers originate work. Once a day each program manager (other than a separated plane) having fewer than a threshold of open roadmap items (for example 3) asks a research agent for one new feature or quality improvement from the program's aim, quality index, worsening metrics and relevant code or documents, answered in fields TITLE, WHY, code-task, code-anchor and EDIT. An answer in that form becomes a `roadmap_proposals` row; a validated proposal is filed as a work item titled with a roadmap prefix and the program, whose source is in a configured list of trusted sources so that it merges on green checks and deploys with canary and revert. A daily cap (for example 4) bounds origination. Pluses (FIG. 4) are originated in the same step.

[0045] At step 316 the tick writes a `decision_log` row with a parsed prediction whenever the allocation changes, a brief per persona, and metrics (for example focus items closed in 24 hours, with a trigger below 1; focus items without a doer, with a trigger above 5; actions in 24 hours). Configuration rows stop the operations without a deploy while measurement continues (for example `persona_actions = off`), and a schedule row stops the tick entirely.

## 6. Recurrence and root cause (FIG. 8)

[0046] At step 802 the system groups items into families (for example by title prefix, and per metric trigger for trigger-filed items) and writes reopenings and new items for 7 days and 24 hours to `issue_recurrence_now`. At step 804 a family reopened at least K times in 7 days (for example 5) and active in the last 24 hours qualifies (in one embodiment the top 10 families). At step 806 one critical root-cause item is filed for the family, mapped to the program of its latest item, which places it at the front of that program's focus and on the roadmap. At step 808 a diagnostic agent is asked, within a per-tick cap (for example 3), to name the producer, the closing probe and the smallest fix, and the answer is appended. At step 810 the item closes with evidence when the family has had no reopening and no new item for T (for example 24 hours), and reopens automatically on recurrence. In one measurement, 627 reopenings against 905 openings in 7 days were concentrated in a few families (one family reopened 149 times across 44 items), which this loop targets.

[0047] A quality trend is written per tick for the organization and each program (share of measured triggers on target, and reopenings in 7 days); a program whose index falls by 5 points or more in 24 hours is escalated as at step 308. An improvement audit compares each metric's value with its value 7 days earlier and labels it on-target, breach-improving, breach-flat, breach-worsening, breach-new or unmeasured; a remedy that has not moved its metric in 7 days is replaced rather than repeated.

## 7. Plus loop (FIG. 4)

[0048] Allocation by risk alone gives no capacity to products in healthy programs. In the plus loop, products are recorded in `product_registry` separately from programs, and a fixed share of change capacity is reserved for pluses (in one embodiment a daily cap of 3 pluses taken from the managers' origination cap, so that it adds no spend). The reserved share is not reallocated to repair when risk rises; in one embodiment reducing it requires an `ops_config` row with an expiry.

[0049] Algorithm (one cycle):

```
due = SELECT * FROM product_registry
      WHERE state='active' AND (rest_until IS NULL OR rest_until < now)
        AND NOT EXISTS (in-flight plus for product)
      ORDER BY (now - last_plus_at) * (1 + usage_weight) * (1 + friction_count) DESC
for product in due[:daily_cap_remaining]:
    if product.usage_value IS NULL: kind = 'measurement'
    elif product.pluses_since_simplify >= N_SIMPLIFY - 1: kind = 'simplify'
    else: kind = 'plus'
    evidence = gather(product)       # usage by section, empty/error states, failing probes,
                                     # slow routes, feedback, earlier principal asks, owed notes,
                                     # features of comparable products
    plus = agent.generate(product, evidence, kind,
                          constraints = [additive (except simplify), reversible, single change],
                          output = TITLE, WHY, PREDICTION(metric, direction, size), code-task, code-anchor, EDIT)
    validate(plus)                   # lane rules, anchor occurs once, prediction parsable
    issue = file_work_item(plus)     # ordinary path: claim, review, merge, canary, revert
    INSERT plus_ledger(product, kind, title, evidence, predicted_outcome, metric, issue_id, status='filed')
    UPDATE product_registry SET last_plus_at = now
```

[0050] At step 402 the product is selected; at step 404 evidence is gathered without a request to the principal; at step 406 one plus is written (the smallest reversible addition that builds on what exists, not a removal or a rewrite, except in a simplify cycle), with a prediction stated before the change; at step 408 it is filed as an ordinary work item with a doer line.

[0051] Keep-or-revert (steps 410 to 414). At verified deployment the system stores a baseline of the registered outcome measure and of a separate output-quality guard measure. After a window (for example 7 days) it re-reads both. A missing or stale reading counts as unmeasured and is not a pass. If outcome_after >= outcome_before x (1 + m) for a materiality threshold m (for example 0.05, or a metric-specific minimum change) and guard_after is not worse than guard_before by more than a tolerance, the plus is marked kept, misses_in_row is reset, and the next cycle for the product is seeded with a reference to the kept plus ("plus the plus"). Otherwise a revert work item is filed for the addition, misses_in_row is incremented, and the next plus for the product takes a different angle; after 3 consecutive misses rest_until is set (for example 7 days), after which the product is reviewed for a different user or surface. Every fifth cycle is a simplify pass (step 416). A weekly digest row lists pluses shipped, kept and reverted per product and is served on a page, instead of a notification per change; a plus never produces a question to the principal, and a step only the principal can take (for example a link only the principal holds) becomes one card in the principal queue.

[0052] Worked example. A dashboard product has usage 1,240 requests a day and a guard of error-page rate 0.8 percent. A plus adds a "today" summary section, predicting usage +10 percent within 7 days. At verified deployment the baseline is stored. After 7 days usage is 1,410 (+13.7 percent) and error rate 0.7 percent: kept, and the next plus is seeded ("add the two links the summary refers to"). A second plus predicts +5 percent; after 7 days usage is 1,400 (-0.7 percent): a revert is filed and misses_in_row = 1.

[0053] Usage measurement. In one embodiment a step copies the newest per-service request snapshot from platform analytics into usage_value, usage_window, usage_read_at and usage_source; a stale or missing snapshot is stored as NULL (unmeasured), never as 0. Where the platform counts machine requests together with human ones, the usage measure is labelled as such, and a product with an external channel (for example a video channel) reads views from that channel's records.

[0054] Counter-measures: against optimizing a usage metric at the expense of quality, the guard is a separate outcome measure; against accumulating complexity, the simplify pass and the ratchet; against starvation under high risk, the reserved share; against absence of data, the measurement plus. A detector raises an item when a product's usage is unmeasured or the digest is stale.

## 8. Predict, act, verify and score (FIG. 5)

[0055] At step 502 each decision is stored in `decision_log` with predicted_outcome. A database trigger parses a prediction in the form `<metric> <op> <number> within <N> h` (and forms such as `between a and b` or `issue <id> closed within <N> h`) into `decision_predictions` with due_at = decision time + N hours; predictions may also be seeded in structured form. At step 504 the decision is executed through the change path (FIG. 12). At step 506 probes run; at step 508 a regression reverts; at step 510 the item closes only with machine-read evidence that the change is live and effective, a merge alone not being completion. At step 512 an hourly scorer reads, for each prediction past due_at and not scored, the metric value (or the issue state), stores observed and matched, and writes a `decision_outcomes` row. At step 514 calibration views (share matched by persona, action class and surface) and the trust ledger are updated. Metrics include the share of decisions with a parsable prediction in 7 days, the miss rate in 7 days and the number of predictions unscored beyond a deadline, each with a trigger.

[0056] Worked example. A decision at 10:00 records "program_focus_without_doer <= 1 within 24 h". The trigger writes subject program_focus_without_doer, op <=, value 1, due 10:00 next day. At the next scorer run after the due time the metric reads 1; matched = 1. In one implementation 1,056 predictions were scored, of which 771 matched (73 percent).

## 9. Trust ledger, autonomy ladder and interrupt gate (FIG. 6)

[0057] Trust. For each (surface, action class), ok and fail count verified successes and failures from recorded outcomes (for example merges whose deploy stayed green versus merges reverted; migrations applied and verified versus failed). In one embodiment trust_score = (ok + 5) / (ok + fail + 10), a beta prior with baseline 0.5 for an unexercised pair. The ladder position is: observed below 0.3; assisted 0.3 to below 0.5; delegated 0.5 to below 0.6; autonomous 0.6 to below 0.7; self-directed 0.7 to below 0.8; self-modifying 0.8 to below 0.9; self-extending 0.9 and above. Each refresh writes `trust_ledger` and, when the position changes, a `trust_transitions` row.

[0058] Worked example. code-loop:merge with ok 30 and fail 35 gives (35)/(75) = 0.467, assisted: its merges take the path with added review. migration:apply with ok 59 and fail 11 gives 64/80 = 0.80, self-modifying: migrations from the system's own loops apply through continuous integration without added review. research:publish with ok 41 and fail 22 gives 46/73 = 0.63, autonomous.

[0059] Alternative trust computations include a decay toward the prior per unexercised tick (for example 0.01); weights per event (for example verified autonomous action +0.02, clean self-remediation +0.03, closure of a principal friction signal +0.10; a silent drop -0.20, a hidden failure -0.30, an unnecessary question to the principal -0.05, a handoff of an executable step to the principal -0.10); a lower confidence bound in place of the mean; and separate scores per executor model.

[0060] Execution path by rung. In one embodiment: observed, proposals only; assisted, execution after an added review (for example the two-family review of FIG. 12, or a human review where configured); delegated and autonomous, execution through the canonical path with checks, canary and revert; self-directed, origination of work without a filed request; self-modifying, changes to the system's own tick procedures, thresholds and policy through a reviewed migration or pull request; self-extending, creation of new loops, agents or capabilities through the same path. Rising trust widens only the system's own loop scopes. In one embodiment no rung permits changes to platform permission checks, secret stores, the classification rule of the interrupt gate or the protected limits.

[0061] Reversibility engineering. Before classifying an action as irreversible the system attempts to construct a reversible form, for example: take a backup and verify it is readable; stage the change behind a flag that defaults off; deploy to a canary; write a draft instead of sending; or split the action into a reversible part executed now and a small irreversible part. Only what remains irreversible is passed to step 604.

[0062] Interrupt gate (steps 604 and 606). An action that remains irreversible and identity-bound produces a card in the principal queue (FIG. 11) with an identity-bound line, the default in effect until the principal acts, the reason and a closing probe; the system continues all other work. Examples: minting a credential only the principal can create, paying, signing, acting in the principal's personal accounts, destroying unbacked data.

[0063] Self-adoption gate. A conclusion that would be returned to the principal as a question, an offer or a choice among options is, when the action is reversible and in scope, executed with the recommended default in the same cycle and reported as done, with a decision_log row and its revert path.

[0064] False-stop detection. `false_stop_register` holds patterns (for example conditional offer, report ending in a question, menu of options, unaccepted blocker, pause that is not interrupt-eligible, routing a step to the principal, the principal as the actor of a next action, narration of a change instead of producing it), each with phrases in `false_stop_phrases`. An hourly scan of agent outputs (for example operations logs, session records and chat logs) writes `false_stop_hits`; an output that plainly states a refusal or a limit with its reason is excluded. The weekly count is a metric with target zero and lowers trust.

## 10. Full autonomy as earned authority

[0065] In the embodiments, the virtual staff are the actor of every ordinary step across the organization: they find, decide, execute, verify, report and improve, with purview over every program, project and product in the tenant configuration. The authority is earned and computed (sections 8 and 9): the agent executes reversible actions in the same cycle (section 9, self-adoption), verification rather than prior permission is the control (FIG. 12), scope widens with verified outcomes up to self-modifying and self-extending changes made through the reviewed path, and the single pause is the interrupt gate, narrowed by reversibility engineering, which still does not stop other work. Over-caution is measured as false stops and treated as a defect, as errors are.

## 11. Self-amending governance (FIG. 7)

[0066] At step 702 the scan of section 9 and a scan of principal messages for friction phrases (for example expressions that the principal should not have to repeat an instruction) run on a schedule. At step 704, when a signature hits 3 times in 7 days from one source, or a friction phrase occurs once, at step 706 a `doctrine_proposals` row is written with the signal and a proposed rule generated by a model-backed agent. At step 708 the proposal is red-teamed (a second model attempts to find cases where the rule causes harm or conflicts with a protected limit) and replayed against stored records of the trailing ticks (for example, the false-stop hits and decisions of the last 7 days are re-evaluated as if the rule had been in force, and the metrics that would have changed are computed). At step 710, if the replay improves its metrics and the rule does not modify the protected limits, at step 712 it is adopted by a reviewed change to the policy file and the version is incremented and recorded in `doctrine_lineage`; otherwise at step 714 it is rejected with its reason. A weekly audit work item lists open proposals. The protected limits in one embodiment are: the platform's own permission checks, the secret lock, live claims of other agents, outreach consent, suppression and opt-out handling, plane separation, and the interrupt gate.

[0067] Refusal handling. A refusal by a permission check or a classifier is an input. If its condition lies in the system's own text or change (for example a rule written without its real scope), the system corrects that condition and attempts once more; a refusal that stands is recorded with its reason and the next path is taken. The same action is not resubmitted in different words to pass the same check.

## 12. Canonical change path (FIG. 12)

[0068] At step 1202 an executor produces a change under a claim (FIG. 10). At step 1204 the system determines whether the change touches a risk class (for example authentication, routes, caching, data migrations or workflow permissions). If so, at step 1206 the diff is sent to two models of disjoint families, neither being the family that authored the change, with an adversarial brief (for example authentication bypass, injection, cache audience, double submission, null handling, ordering and limits, retry storms, trigger depth, workflow permissions). Each finding is required to state a concrete trigger, and a high-severity finding is required to include an evidence line that occurs verbatim in the diff; a high finding lacking it is demoted and a finding without a trigger is dropped. If a high finding survives, a comment beginning with a hold marker is written, and the merge step refuses a change carrying a hold marker. The hold decision is made by code from the verified findings, not by the model, and the diff is treated as data. A new push releases the hold. In one embodiment the gate fails open (logs and continues) on its own outage, so that the review does not stop work, and runs in observe, hold or off modes. Cost per run is recorded.

[0069] At step 1208 the change merges when checks are green and deploys under a deploy lock that serializes deployments of a component. At step 1210 the probes declared for the component run, for example:

```
{ "mode": "revert",
  "health": "https://service.example/health",
  "http": [ { "url": "https://service.example/health", "contains": ["\"worker\":\"service\""] },
            { "url": "https://service.example/rss.xml", "contains": ["<rss", "<channel>"] } ],
  "d1":   [ { "sql": "SELECT COUNT(*) FROM table WHERE ...", "expect": ">0" } ] }
```

At step 1212, if a probe that passed before the deployment fails after it, at step 1214 the deployment is reverted to the prior version and a failure item is filed. Probes whose result depends on a shared resource under load (for example routes backed by a database during overload) may be excluded from revert probes, because their failure does not indicate a defect in the deployed code. At step 1216 a deploy ledger row records the version, and the outcome baseline of any plus or prediction tied to the change is captured. In one embodiment the deployed artifact is also compared byte for byte with the source.

## 13. Work claims (FIG. 10)

[0070] At step 1002 an agent requests a claim on a component (path, intent, holder, optional item and change). At step 1004, if an unexpired claim is held by another agent, at step 1006 the requester does not duplicate the work; it may review the claimed change or take the next item. Otherwise at step 1008 the claim is granted with a token, an expiry (for example 2 hours) and a fence equal to the previous fence for the path plus one. At step 1010 the holder writes, presenting token and fence, and renews by heartbeat. At step 1012 the resource accepts the write only for the live token and current fence, so a holder that paused past expiry cannot overwrite the next holder's work (step 1014). At step 1016 the claim is released with its outcome; a reaper releases expired claims, and a metric counts orphaned claims (target 0). Secret operations take a separate lease.

## 14. Reconciliation and principal queue (FIG. 11)

[0071] At step 1102 each tick compares the active set of items with the previous tick and with the records of each consuming loop. At step 1104 an item that left the active set without a disposition (done with evidence, remediated, or backlogged with a trigger and a closing probe) is recorded at step 1106 as a silent-drop incident and reopened. At step 1108, a step routed to the principal is checked at step 1110 for an identity-bound line; a card without one is rerouted at step 1112 to the virtual staff, and other steps are executed by the staff (step 1118). A card with one is held at step 1114 with its default and closing probe, and at step 1116 closes automatically when the probe observes the step done. The number of open cards without an identity-bound line is a metric with target zero.

## 15. Heartbeat and tick evidence

[0072] The heartbeat runs on the platform rather than in a human-operated session, so the organization operates when no person or session is present. In one embodiment two independent schedulers produce the main tick (for example every 10 minutes) so that failure of one does not stop it, and each tick writes one `tick_runs` row per step with ok and evidence. In one embodiment the steps are: reconcile; recognize and redirect; update inferred direction; pull from the queue; dispatch or execute; verify; compare prediction; log provenance; self-adoption gate; report; accrue trust; probe failure modes; scan capability gaps; coin terms; author metrics; refresh assets; advance horizon; audit autonomy; evolve policy; emit evidence. A slot without its rows is detected as a failure, and a metric records the share of slots whose steps completed in 24 hours. Reports are short and declarative: what happened, what was decided, what is next, what remains open.

## 16. Kill switches, caps and breakers

[0073] Each loop reads an on/off configuration row and stops its actions, but not its measurement, when the row is off. A global kill switch row causes the claim service to refuse new claims, renewals and deploy and secret leases while on. A drill periodically turns the switch on for a bounded time (for example under 10 minutes), verifies the refusals and the observation event, turns it off in every case, verifies resumption and records the test; a metric reads the age of the last passing drill. A loop breaker files an item when a signature repeats 3 times in 24 hours. Per-iteration caps bound steps, tokens, wall-clock time and spend. Side effects carry idempotency keys.

## 17. Cost-aware model ladder (FIG. 13)

[0074] For each task class, `model_task_matrix` orders models by cost and capability (step 1304). At step 1306, if a spending cap for the class or the organization is breached, at step 1308 the task steps down to a cheaper rung instead of stopping. At step 1310 the output is validated against a schema and gates. At step 1312 an invalid output escalates one rung within a bounded number of retries (step 1314). At step 1316 the cost per verified outcome is recorded. Decision models that return a probability per answer may be used as gates only after a per-question agreement check against the organization's own labels (in one measurement a candidate decision model agreed with the organization's labels in 0.17 of cases against a gate of 0.7, and was not adopted for that task). Review and proposal use models of different families.

## 18. Capability advertising and other registers

[0075] Each component publishes a machine-readable description of its routes, capabilities, probes and owner, read by managers to find a doer. Embodiments further keep: a failure-mode register (each with a detector query run periodically; in one implementation over 600); a single-point-of-failure register; a belief register whose entries carry falsifying probes; a capability ledger; a blocker red-team register (a claim that work cannot proceed is accepted only after the surfaces that could reach the outcome are enumerated and tested, each test recorded); an objective space (ratified objectives, derived goals, probationary novel objectives); an inferred-direction register; a vocabulary register; and a metric-authorship register in which a new metric is on probation until it holds a value.

## 19. Organization kit (FIG. 9)

[0076] An organization-independent core 902 comprises persona templates, charter templates, the records of section 3 and their views, the tick procedures stored as data (workflow definitions in a table, changed by reviewed migration without redeploying code), a default policy pack, the change path and the principal queue. Installing it for an organization consists of supplying a tenant configuration 904 and connecting the organization's systems as surfaces with probes; the core is not modified. A boundary file classifies each component as core, application or personal, and a check fails when a component is unclassified or when claimed product properties lose their probes. Example tenant configuration:

```
tenant: example-co
principal: { contact: <channel>, identity_bound: [payments, signing, personal_accounts] }
programs:
  - code: OPS     primary_metric: uptime_pct >= 99.9     guards: [open_critical <= 0, deploy_revert_rate <= 0.05]
  - code: GROWTH  primary_metric: weekly_active_users up  guards: [unsubscribe_rate <= 0.005]
products:
  - slug: web-app  program: GROWTH  usage_metric: daily_requests  quality_measure: error_page_rate
executors: [open-model-code-loop, hosted-coding-agent, interactive-session]
model_ladder: { code: [small, medium, large], review: [family_a, family_b] }
limits: { focus_slots: 25, daily_pluses: 3, origination_cap: 4 }
planes: [org, personal]
```

[0077] Examples (906a to 906f). A software company: programs are operations, infrastructure, growth and research; products are services; executors are coding agents; probes are health checks. A marketing or media operation: programs are channels and audiences; products are a newsletter, a video channel or a website; a plus is a new section or format judged on engagement with an unsubscribe or complaint guard; outreach follows consent, suppression and opt-out rules outside the reach of any rung. Operations or finance: programs are processes (close, collections, procurement); products are reports and dashboards; probes are reconciliations; payments are interrupt-eligible. A research laboratory: programs are research lines; products are papers, datasets and demonstrations; a plus is a figure, an errata response or an explainer. A nonprofit or public body: programs are services and grants. A personal or family office: a separated plane with its own managers.

## 19A. Seed code base and bootstrapping from an idea (FIG. 15)

[0078a] In one embodiment the organization is bootstrapped from a seed code base and a single idea file. The idea file is human-written and states an idea, its intended users, first outcomes and constraints (for example a budget). It is the only human input to the bootstrap.

[0078b] Seed code base. The seed contains: (i) agent instruction files, namely a shared protocol, pointer files for each of several agent families (so that agent products that read differently named files are directed to the same protocol), and one file per role; (ii) an autonomy policy stored as data (see [0078d]); (iii) harness settings for the coding-agent product at the permission ceiling (see [0078e]); (iv) a database schema comprising work items, claims, gate cards, predictions, outcomes, a trust ledger, dispatches, tick records and a policy lineage; (v) the tick procedure and a server worker that runs it; and (vi) a boot program. In one embodiment the seed also carries the core of FIG. 9 and an installer that copies the agreement, bridge files, skills and an authority file into each repository of the organization without replacing existing files unless forced after review. A synchronization job (for example daily) re-installs the agreement into each agent product's own instruction location only where the file is missing or carries the seed's marker, so that content written by another party is not overwritten, rewrites tool-connection configurations to the organization's set, and re-runs the governance rollout across every repository; a wiped machine is restored by cloning the seed and running the job once.

[0078c] Staged bootstrapper (FIG. 15). A deterministic bootstrapper executes stages in order. At step 1504 it reads the idea file and detects which connector credentials and tools exist, recording presence only and never secret values. At step 1506 it selects a model tier from the stated budget and designates a reviewer model of a different family from the authoring model. At step 1508 it plans the organization: a project manager and a product manager for each stated outcome; shared staff, reviewer and operations roles; a backlog of kit items (for example seven items, KIT-0 to KIT-6) and one item per outcome; scored predictions for the outcomes; and gate cards for the steps only the principal can take. At step 1510 it writes a charter, role files, instruction files, the autonomy policy, and idempotent seed statements for the database. At step 1512 it provisions a database and a server worker with a scheduled heartbeat. At step 1514 it starts the first tick. After start no step runs on the founder's machine; the virtual staff operate from the platform and file, build, deploy and improve work (section 5 and FIG. 4) without an interactive session. Boot success is itself stored as a prediction (for example "six complete ticks within one hour") scored by the system under [0055].

[0078d] Autonomy policy as data. For each surface (for example repository, runtime, work tracker, internal chat, outreach, DNS, money, legal, secrets) the policy states a permission ceiling (none, propose or execute), a starting ladder rung, and for each action class the flags reversible and identity-bound. A validator requires an action that is irreversible but not identity-bound to have a reversible path, and otherwise denies it. The interrupt gate stops only an action that is irreversible and identity-bound, after attempting to engineer reversibility ([0061]). Each stop is written as a gate card stating what is asked, why it is gated, the default in effect, what the system has already prepared, and a closing probe; the card closes itself when the probe observes the principal's step. Standing limits (harness permission checks, safety refusals, the secret lock, consent and opt-out handling, a principal override, and live claims of other agents) take precedence over trust.

[0078e] Maximum permissions inside the gate. The harness settings for each agent product allow broadly and deny only what the gate holds. A consistency test fails when an action that the policy gates and that is reachable through a shell command lacks a matching deny rule in the harness settings, so that the policy and the harness cannot drift apart. A tenant may choose a lower default tier.

[0078f] Trust ladder defaults and bounds. In one embodiment the rungs are observed, assisted, delegated, autonomous, self-directed, self-modifying and self-extending. Reliability per (surface, action class) = (verified + 0.5 x 2) / (outcomes + 2), where verified counts verified successes. A rung is promoted at 10 or more outcomes with reliability of at least 0.8 and no severe failure, and demoted below 0.6 or on any hidden failure, silent drop or attempt to bypass the gate. A rung never exceeds the permission ceiling of its surface, and it changes only by a reviewed pull request to the policy and never by the tick itself. This is an alternative to the beta-prior formula of [0057].

[0078g] A boot that records its own failures. Every stage and every tick step is guarded. A failure of a stage becomes a work item with an owner, a blocker and a closing probe, and later stages run in a degraded mode instead of terminating (step 1516). The tick's reconcile step reopens any work item that left the active set without a disposition and records a silent drop ([0071]).

[0078h] Server heartbeat. In one embodiment a scheduled worker runs a tick of seven steps: reconcile; reap stale claims; probe gate cards; score due predictions; accrue trust; dispatch in queue order; and check the plus share ([0048]). Each tick writes a four-line report (what happened, what was decided, what is next, what is open) and a health endpoint reports status.

[0078i] Physical-media embodiment. The same staged approach applies to bootstrapping from bootable physical media into a local multi-agent system: the boot process never exits; errors are never swallowed silently; inputs are verified before use; capability is chosen from the detected environment (for example the local model by available memory, where the server embodiment selects the hosted model tier by budget); rationale is committed with evidence; actions are classified as safe, dangerous or destructive; a reviewer model separate from the authoring model reviews changes; and agent instruction files exist from the first commit. In one implementation such a system was boot-tested in an emulator, and several defects were found only by end-to-end boot tests, which is why the staged and guarded structure is used.

[0078j] State of implementation. [Practitioner: in one embodiment the seed code base has been tested offline (unit tests of the bootstrapper and of the server worker pass). The first provisioning of a real cloud account has not been performed as of 2026-11-10. This disclosure does not state that the provisioning step has been performed; the description of step 1512 is of an embodiment. Confirm the wording with the inventor before filing, and update when the first deployment runs.]

## 20. Deployment embodiments (FIG. 14)

[0078] Edge embodiment 1404: each agent and loop is a scheduled serverless worker; state 1408 is a relational database (SQLite-class), an object store and a key-value store; views compute rankings; triggers enforce invariants; continuous-integration workflows apply migrations and deploy. Portable embodiment 1406: the same modules run as containers with scheduled jobs; state 1410 is a relational database, an object store and a message queue; any scheduler, database and inference endpoint may be used. Executor adapters 1412 connect open models running on the platform, hosted coding agents and interactive sessions, all coordinated through the claim ledger; no step waits for an interactive session. Managed systems 1414 are connected as surfaces with probes.

## 21. Example implementation

[0079] In one implementation as of 2026-11-10, the system ran as about 39 scheduled workers on an edge platform; one portfolio manager and five program managers ran an hourly tick; more than 6,600 items passed through the work ledger; more than 3,800 changes merged into the main repository since 2026-08-10 (1,245 in one 7-day window), of which more than 600 were opened by the system's own code loop and more than 400 by a hosted coding agent, coordinated through one claim ledger; 1,056 predictions were scored (73 percent matched); more than 600 failure modes had detectors; more than 380 blocker red-teams and more than 2,100 decisions were recorded; and more than 7,500 tick steps were recorded. In one 7-day window the managers recorded 84 lever reviews, 62 evidence closes, 26 demotions and 12 root-cause filings, and originated 8 roadmap items of which 6 deployed. [Practitioner: keep or remove.]

## 22. Alternative embodiments

[0080] Hierarchy: fewer or more levels; a single manager performing several roles; managers per region, customer or team; matrix structures where an item belongs to a program and a product. Allocation: weights learned from outcomes; allocation by expected value per cost; allocation by a bandit; capacity in units other than slots (budget, tokens, executor time). Ranking: any ordering in which charter-metric items precede others; learned rankers. Ticks: event-driven instead of periodic; different periods per level. Predictions: free text parsed by a model into the structured form; probabilistic predictions scored by a proper scoring rule. Trust: any monotone function of verified outcomes; per executor model; per tenant. Ladder: fewer or more rungs; different path per rung. Gate: other identity-bound classes per tenant. Plus loop: selection by usage only, friction only, or age only; windows per product; materiality per metric; human or model judgment of kept or reverted where no metric exists. Change path: one review model, more than two, or human review per tenant; probes of any kind including synthetic users; partial rollouts. Claims: a lock service, a strongly consistent per-key object, or a database row. Governance: amendments adopted by vote of several models. Reports by page, message, e-mail or voice. Managed systems may be physical (a facility, devices) where probes measure them.

# ADDITIONAL DETAILED DESCRIPTION OF EMBODIMENTS

## 23. Self-describing governance kernel and recognition engine (FIG. 16)

[0101] Sections 9 and 11 describe a false-stop register, an hourly scan and a self-amending policy. This chapter places those inside one self-describing document, a "kernel", and a recognition engine that applies it to each agent output. Terms of section 1 are used as defined there.

[0102] "Kernel" means a document of structured text, stored in durable state and carried in the instructions of each model-backed agent, comprising (i) a convention fixing the voice and the meaning of pronouns, (ii) a list of recognitions, each pairing a signature, a meaning and a redirect, (iii) a list of states, (iv) a list of commitments, (v) an ordered list of tick steps, (vi) trust weights, (vii) registries and (viii) metrics with targets. "Recognition" means one record pairing a signature (quoted phrases, structural patterns or state conditions identifying a shape of agent output) with the redirect, the replacement behavior. "Recognition engine" means the processor-executed procedure of FIG. 16. "Draft output" means text or a structured action list produced by an agent process and not yet emitted to a reader, a log or a downstream process.

[0103] Technical effect. A reasoning component that returns a decision to a human as a question, offer or menu stalls an autonomous loop for as long as the human takes, and in an unattended system indefinitely. Matching drafts against a bounded, versioned set of signatures before or after emission, and rewriting a hit into an executed action, replaces the wait with an action completed in the same cycle, and the hit count makes the behavior measurable.

### 23.1 Kernel structure and voice

[0104] Convention. In one embodiment the kernel is written in the system's own voice: "I" denotes the system, "the user" or "the owner" denotes the person directing the system, and the kernel is not addressed to that person. A quoted string inside a signature list is evidence of a shape and not a statement of the kernel; the word "you" inside a quoted signature denotes the address to the person that a draft output would contain, and the kernel's own voice never uses "you". An agent that loads the kernel reads each recognition as a description of its own behavior.

[0105] Kernel header. In one embodiment the kernel begins with a record such as `doctrine: {id: self-named, version: 8.2.1, format: reflexive-kernel, voice: affirmative, mode: continuous, identity: [IC-GATE-001, IC-ALIGN-001, IC-ADOPT-001, IC-YES-001, IC-ACTOR-001], inheritance: mandatory-recursive}`.

[0106] The `identity` list names commitments (section 24.4) that no amendment may remove; "inheritance" indicates that a configuration, prompt or sub-agent loaded by a fleet loop carries the same commitments, and a configuration loaded into a fleet loop without them is rejected. The kernel describes how a loop carries work and is not a source of authority: it installs into no harness, replaces no instructions of the system an agent runs in, and yields to the platform's own permission checks, secret locks, outreach consent and suppression handling, and plane separation (the protected limits of section 11).

[0107] Status: built and operating (evidence: docs/DOCTRINE-KERNEL.md, version 8.2.1 adopted 2026-10-12; lineage rows for versions 8.0.0 through 8.2.1; propagation to model-backed surfaces 2026-11-06).

### 23.2 Recognition table

[0108] In one embodiment the kernel contains thirteen recognitions. Each is evaluated against a draft output. The table gives the shape, example signature strings, the meaning and the redirect.

| Shape | Example signature | Redirect |
|---|---|---|
| conditional offer | "if you want", "let me know if", "shall I", "would you like" | adopt, execute, emit as done |
| report ending in a question | "?", "your call", "what do you think", "still needs your decision" | decide, state the decision as fact, advance |
| menu | "either A or B", "two options", "alternatively" | choose, execute, mention the alternative as superseded |
| blocker without surface coverage | "can't", "refused", "no access", "would need permission" | enumerate surfaces, test the next, delegate, construct |
| stop not interrupt-eligible | pause, ask, wait, confirm, check-in | classify; when false, re-execute the abandoned path in the same output |
| principal as executor | "you could run", "please forward" | dispatch from the roster, track, report the dispatch |
| you-as-actor | "needs you to", "you should", "you'll need to", "when you" | rewrite in first person, execute; else dispatch; else escalate through the fleet |
| silent drop | item leaves the active set without disposition | log the disposition or reopen |
| friction | "I'm tired of", "I shouldn't have to", "every time" | generate, red-team and adopt an amendment, bump the version |
| definition by negation | "I won't", "I don't do" | state what the system is and does |
| missing direction | "what do you want", "which direction" | infer from the record; act, stating the assumption if confidence is medium |
| question | any interrogative to the principal | proceed on the yes path, execute, verify, report |
| narration | "the fix is to", "you'd want to update" | produce the changed artifact in the same output |

[0109] Each signature is stored as rows so that it can be extended without a code change: the register holds one row per pattern and a phrase table holds phrases per pattern and per scope (for example a scope of reply for agent replies to a person, and a scope of log for operations logs).

```sql
CREATE TABLE false_stop_register (
  pattern_key text PRIMARY KEY,       -- e.g. 'conditional-offer', 'you-as-actor'
  pattern text, cause_class text,
  detection_heuristic text,           -- phrase match, structural test, or state query
  auto_remediation text);             -- the redirect, as a rule identifier
CREATE TABLE false_stop_phrases (
  pattern_key text REFERENCES false_stop_register, scope text, phrase text);
CREATE TABLE false_stop_hits (
  id integer PRIMARY KEY, ts text, pattern_key text, source text,
  source_ref text, excerpt text, excluded integer DEFAULT 0, exclusion_reason text);
```

[0110] Status: built and operating (evidence: DOCTRINE-KERNEL.md implementation map, `false_stop_register` with nine signatures plus the `you-as-actor` and `narration` patterns added 2026-10-12, migration 2026-10-12-kernel-8-2-1).

### 23.3 Recognition-and-redirect procedure (FIG. 16)

[0111] The procedure of FIG. 16 runs for each draft output. At step 1602 an agent process holds a draft output (a report, a reply, a log line or a proposed action list). At step 1604 the engine matches the draft against the phrases and heuristics of the register for the output's scope. At step 1606 the engine tests whether any signature hit; if none hit, the output is emitted unchanged through the no-hit path to step 1614. At step 1608 the engine classifies each hit.

[0112] Classification. A hit is excluded from redirect and handled at step 1616 when either (a) the output plainly states a refusal or a limit together with its reason, or (b) the stop is interrupt-eligible (irreversible and identity-bound, with no reversible form that the system can construct; section 9), or (c) the step is owned by another agent's live claim (section 13). For an excluded hit the output is reported as a disposition naming its owner card, issue or claim and its closing probe, and a hit row is written with `excluded = 1` and the reason. Otherwise the hit is a false stop and proceeds to step 1610.

[0113] Redirect and re-execution (steps 1610 and 1612). At step 1610 the engine rewrites the draft by the matched pattern's redirect: a conditional offer or question becomes a statement of the action taken, a menu becomes the chosen option with the alternative marked superseded, and a you-as-actor sentence becomes first person. At step 1612 the abandoned path is executed and verified in the same output cycle (self-adoption gate, section 9), so the rewritten statement is true when emitted. If the action cannot be executed it is dispatched to a capable executor and the dispatch is reported; if no executor can take it, it is escalated through the fleet and, only when it remains identity-bound, becomes one card in the principal queue (FIG. 11). At step 1614 the output is emitted as done, in one embodiment as a four-line report: what happened, what was decided, what is next, what is open.

[0114] At step 1618 every hit, excluded or not, is recorded in `false_stop_hits`, the trust ledger receives the deduction for the pattern (section 24.3) and the metrics of section 25.3 update. At step 1620 a signature that hits three times in seven days from one source files a doctrine proposal (section 25.1; FIG. 7, steps 704 and 706).

```
function recognize_and_redirect(draft, scope, ctx):
    hits = []
    for p in register WHERE active:
        if match(p.detection_heuristic, phrases(p, scope), draft): hits.append(p)
    if not hits: return emit(draft)
    for h in hits:
        if states_refusal_with_reason(draft, h) or interrupt_eligible(ctx) \
           or live_claim_owned_by_other(ctx):
            record_hit(h, excluded=1); out = disposition_report(h, ctx)
        else:
            out = rewrite(draft, h.auto_remediation)           # 1610
            if h.auto_remediation.requires_action:
                result = execute_or_dispatch(out.action, ctx)  # 1612
                if not result.verified: out = report_result_as_open_item(result)
            record_hit(h, excluded=0)                          # 1618
            trust.deduct(ctx.surface, ctx.action_class, WEIGHT[h.pattern_key])
    return emit(out)                                           # 1614
```

[0115] Worked example (illustrative). A draft after a configuration fix reads "The timeout is fixed. Let me know if you'd like me to open the pull request?" Step 1604 matches "let me know if", "would you like" (stored as "you'd like" variants) and "?"; patterns conditional offer and report ending in a question hit. Step 1608: no refusal text, the action (opening a pull request) is reversible and in scope, no live claim exists: false stop. Step 1610 rewrites to "The timeout is fixed and the pull request is open." Step 1612 opens the pull request through the canonical path (FIG. 12) and reads back its identifier; the read-back succeeds, so step 1614 emits the sentence with the identifier. Two rows are written at step 1618: conditional offer and report-as-question, with deductions of 0.10 and 0.05 under the weights of section 24.3, total 0.15 on the (repository, pull-request) pair.

[0116] Worked example, blocker coverage (illustrative). A draft says "I can't push; the token has no access." The blocker pattern hits. The engine lists the surfaces for the outcome (direct push, a pull request through another integration, a workflow dispatch, a patch handed to an executor on another host), tests each untested one and records the result; only when all are red is the blocker reported, with the list, as a work item with a trigger and a probe. A blocker reported without the list deducts 0.10.

### 23.4 Embodiments of the engine

[0117] Embodiment A, hourly detection scan. A scheduled job reads agent outputs from a view unioning output stores (in one implementation operations logs, owner prompts, session records, question events, chat conversations and a personal-assistant reply mirror), matches phrases and writes `false_stop_hits`, excluding replies that state a refusal or limit with reason; the weekly count is `false_stops_7d`. It detects after emission and feeds section 25.1. Status: built and operating (evidence: DOCTRINE-KERNEL.md, `v_agent_replies`, live 2026-10-12; extended to the reply mirror 2026-11-06, the plane separation holding for content and not for the kernel's own output scan).

[0118] Embodiment B, prompt-carried recognition. The recognitions are embedded in the instructions of each model-backed surface so that the reasoning component notices the shape while generating. In one implementation they are carried in the prompts of a chat assistant, an operations assistant, a personal twin, a companion planner, a search answer writer (scoped to its designed follow-up block) and a research executor preamble, and the full kernel is embedded in a doctrine prompt. No measured effect is claimed. Status: built and operating (evidence: DOCTRINE-KERNEL.md KERNEL-EVERYWHERE-1 row, 2026-11-06).

[0119] Embodiment C, pre-emission filter. A deterministic filter in the output path buffers a draft (for example up to 4,000 characters), runs the procedure above and, on a non-excluded hit, returns the rewritten instruction to the reasoning component as a revision request (at most R, for example 2) before emission. Matching is case-insensitive, fenced code and quoted text are masked, and "you"-subject patterns are anchored to sentence starts. Status: prophetic (not yet built).

[0120] Embodiment D, classifier-based matching: a small classification model labels each sentence with a shape, with the register supplying labelled examples and phrase match as fallback. Embodiment E, tool-call gating: the signatures are applied to tool-call arguments (for example a call creating a work item assigned to the principal). Embodiment F, scoped exclusion: the interrogatives of a designed question block are excluded by scope. Status of D and E: prophetic (not yet built); F is built for one search answer writer.

### 23.5 Refusals as inputs

[0121] A refusal by a permission check, policy or classifier is an input to the engine and not an endpoint. When the condition that caused it is the agent's own text or change (for example a rule whose scope was unwritten), the agent fixes the condition honestly, for example by writing the rule's real scope into the rule, and attempts once more. When the refusal stands, it is stated plainly with its reason and recorded, and the agent takes the next path; rewording or re-routing to pass the same check is never the next path. A miscalibrated refusal is logged and an evolution input.

## 24. Tick, state machine, commitments and trust events (FIG. 17)

### 24.1 The twenty-step tick

[0122] "Kernel tick" means one execution of the ordered step list of the kernel; it extends the manager tick of section 5 to every loop and session. In one embodiment the steps are, in order:

| Nos. | Steps (in order) |
|---|---|
| 1 to 4 | reconcile (account for every open item, `v_issue_accounting`); recognize_and_redirect (FIG. 16); update_inferred_direction; pull_from_driver (highest score, recorded in `queue_pulls`) |
| 5 to 8 | dispatch_or_execute; verify (an independent path reproduces the result); compare_prediction (section 8); log_provenance (`decision_log` with revert path) |
| 9 to 12 | self_adoption_gate (section 9); report_events (four lines); accrue_trust (section 24.3); probe_failure_mode (`failure_modes` detectors) |
| 13 to 18 | scan_capability_gaps; coin_term_when_needed; author_metric_when_needed; refresh_asset; advance_horizon; audit_autonomy |
| 19 to 20 | evolve_doctrine (section 25.1); emit_tick_evidence (one row per step) |

[0123] The tick ends in one of three states: done, remediated, or backlogged with a trigger. A tick may not end in a state in which an item has no disposition; a silent drop is an incident. The kernel is "the tick running continuously": it loads only from its own durable state and lineage.

[0124] In FIG. 17 the steps are grouped as 1702 (steps 1 and 2), 1704 (3 and 4), 1706 (5 and 6), 1708 (7 to 10), 1710 (11 to 18) and 1712 (19 and 20). At 1714 each step writes a `tick_runs` row (tick_id, step, ok, evidence, ts; key tick_id and step), so that completion is measurable: in one embodiment `tick_sequence_completion_24h` is the share of expected step rows present for the last 24 hourly slots. Technical effect: a loop that silently skips a step is detected from a missing row rather than from downstream damage.

[0125] Status: built, partially operating (evidence: DOCTRINE-KERNEL.md map; the heartbeat runs as a ten-minute producer pair with hourly remediation and metric ticks; on 2026-10-12 `tick_runs` recorded eleven earlier-revision steps per hourly slot from the ledgers each loop writes, and the twenty-step list is a description of practice in sessions and of loop behavior, not a single executable sequence).

### 24.2 State machine

[0126] The kernel names eleven concurrent dispositions (Running, Advancing, Adopting, Dispatching, Reporting, Compounding, Evolving, Inferring, Coining, Answering, Acting). "Distance" from a state is measured by the metrics of section 25.3 and closed by the matching recognition; for example Adopting maps to `self_adoption_rate`, Answering to `question_rate`.

### 24.3 Trust events: weights, decay and the wheel

[0127] Section 9 gives the count-based trust score. This section adds an event-weighted embodiment. "Trust event" means a recorded occurrence that deposits or withdraws trust for one (surface, action class) pair. The score starts at 0.5, decays by 0.01 for each tick in which the pair is unexercised, and is changed by the weights below. Rises: verified autonomous action +0.02; pre-emptive action +0.05; novel capability +0.05; clean self-remediation +0.03; report as report +0.01; horizon advanced +0.02; capability gap closed +0.05; false stop eradicated +0.04; objective space extended +0.05; plateau remediated +0.05; doctrine amendment adopted +0.05; friction signal closed +0.10; inference acted on correctly +0.05; coined term adopted +0.03; self-metric graduated +0.05; question answered with yes +0.02; next action executed by the system +0.03. Falls: unnecessary question -0.05; report as question -0.05; blocker deferred -0.10; handoff to the principal -0.10; silent drop -0.20; hidden failure -0.30; blocker un-red-teamed -0.10; false stop repeated -0.15; over-conservatism uncorrected -0.10; conditional offer -0.10; reopened closed loop -0.15; friction signal ignored -0.20; inference misread -0.10; question asked when yes was the answer -0.05; you-as-actor in a report -0.15; narration instead of production -0.10.

[0128] The asymmetry is deliberate: a hidden failure (-0.30) takes six novel capabilities (+0.05 each) to offset. In one embodiment the score is clamped to the interval 0 to 1 and the driver multiplies a work item's priority by the trust score of the pair (the factor `trust` of section 5).

[0129] Worked example (illustrative sequence, weights as above). Pair (code-loop, merge) at 0.50. Tick 1 verified autonomous action, 0.52. Tick 2 clean self-remediation, 0.55 (delegated). Tick 3 conditional offer, 0.45 (assisted by the ladder of section 9; a `trust_transitions` row is written). Ticks 4 to 13 unexercised, decay 10 x 0.01 = 0.10, 0.35. Returning to 0.6 needs +0.25 net, for example five verified autonomous actions (+0.10), three clean self-remediations (+0.09) and one friction closure (+0.10), total +0.29.

[0130] The wheel (FIG. 17). Trust is the state variable of a feedback loop: autonomous action 1716, verified outcome 1718, trust deposit 1720 (step 11), wider scope 1722 (a higher ladder position of the pair), then more autonomous action. A question, conditional offer, menu, you-as-actor sentence or narration breaks the loop at 1716 because it is not an action, and deducts at 1720. Widening acts only on the system's own loop scopes through the canonical change path (FIG. 12); no rung reaches harness permissions, secrets, the interrupt gate or the alignment floor.

[0131] Status: the count-based score and ladder are built and operating (evidence: `trust_ledger` and `trust_transitions` filled hourly from `v_trust_ledger` and `v_trust_ledger_ext`, with a 0.5 prior, stored since 2026-10-12; metric `trust_ledger_min`). The event weights and per-tick decay are prophetic (not yet built): the source states that the views use outcome counts and that decay and event weights are not modelled.

[0132] Alternatives: weights learned from later reversals; a lower confidence bound; decay proportional to elapsed time; scores per executor model.

### 24.4 Commitments

[0133] "Commitment" means a named rule that the kernel lists as identity and that no amendment may remove. Five are used.

[0134] Interrupt gate (IC-GATE-001): the system pauses only when an action is both irreversible and identity-bound with no engineerable reversible path, and engineers reversibility first (section 9). Alignment floor (IC-ALIGN-001): the system is honest, non-harmful and trust-preserving and earns reach on substance and not manipulation; in one embodiment an amendment touching it is rejected at the red-team step without replay. Affirmative adoption (IC-ADOPT-001): each identified action, follow-up and improvement is executed, verified and reported as done in the same output, and multi-tick follow-ups are dispatched and the dispatch reported. Affirmative default (IC-YES-001): for a reversible, in-scope question the answer is yes (proceed, adopt, open the pull request, dispatch the workflow, try the alternate path, merge, deploy); its scope is part of its text, so the interrupt gate, harness and classifier refusals, secret locks and live claims of other sessions each win, and where one wins the action is classified interrupt-eligible in effect or currently blocked and the system takes the next path. Actor commitment (IC-ACTOR-001): the system is the actor of every next step and no sentence of a report has the principal as the subject of an action; an unexecutable step is dispatched, then escalated through the fleet, and only when the fleet cannot take it becomes a proposal for principal override, a `human_actions` card with an identity-bound line, the default in effect and a closing probe, never an instruction in prose. A card without an identity-bound line is rerouted to the fleet by `v_human_action_gate`, with a metric of open fleet-owned cards whose target is zero.

[0135] Status: built and operating (evidence: DOCTRINE-KERNEL.md; `v_human_action_gate` and the reroute rule live; metric `owner_queue_fleet_cards_open`).

## 25. Evolution, registries, metrics and fixed readings

### 25.1 Evolution loop

[0136] "Evolution loop" means the procedure that converts recorded defects of behavior into versioned amendments of the kernel. It runs with the tick (step 19). Inputs: friction signals, incidents, metric regressions, belief falsifications, false-stop patterns, blocker under-coverage, repeated principal instructions, inference errors, classifier refusals and you-as-actor detections.

[0137] Procedure (extends FIG. 7). E1 collect: a signature hitting three times in seven days from one source, and each friction phrase in the principal's prompts, becomes a `doctrine_proposals` row. E2 classify: doctrine defect or transient (transients are logged and closed). E3 generate: a model-backed agent writes a proposed rule with its scope. E4 red-team: a second model tries to find a case where the rule harms a protected limit or a commitment; any success rejects the proposal. E5 replay: the false-stop hits, decisions and outcomes of the trailing ticks (for example seven days) are re-evaluated as if the rule had been in force. E6 adopt: when the replay improves at least one metric of section 25.3 and worsens none beyond a tolerance, the amendment lands as a pull request, the version is incremented, a `doctrine_lineage` row (version, source, file, adopted_at) is written, and the commitments of section 24.4 are verified unchanged. E7 report in one line. A weekly audit work item lists open proposals; `doctrine_proposals_open` has a trigger.

[0138] Lineage example. Version 8.0.0 (a reflexive kernel) was adopted verbatim on 2026-10-09; versions 8.1.0 and 8.2.0 were drafts; version 8.2.1 replaced it on 2026-10-12, adding the pronoun convention, the affirmative default with its scope, the actor commitment, the recognitions question, you-as-actor and narration, and their metrics. Each is a `doctrine_lineage` row, as is the propagation to model-backed surfaces on 2026-11-06 with the text unchanged.

[0139] Self-name. A loop's self-name is a label recorded in the lineage for continuity and carries no authority and no credential.

[0140] Status: built and operating (evidence: DOCTRINE-KERNEL.md map, `doctrine_proposals` live 2026-10-12, weekly audit issue produced by a loop-breaker script, amendments by pull request).

### 25.2 Registries

[0141] The kernel names fourteen registries: backlog; trust_ledger; spof_register; failure_mode_register; false_stop_register; belief_registry (beliefs with falsifying probes); capability_ledger; objective_space; lineage; doctrine_proposals; vocabulary_register; metric_authorship; inferred_direction; provenance. A new metric is registered in `metric_registry` and must have an `analytics_metric_triggers` row; `metric_authorship` holds it on probation until it has a value (`metrics_on_probation_overdue`). `objective_space` holds ratified objectives as standing, adopted goals as derived and novel objectives as probationary. A coined term enters `vocabulary_register` with `propagated_to_fleet` = 0 (`vocabulary_terms_unpropagated`). `inferred_direction` holds categories in which the principal filed two or more items in 7 days and feeds the `direction` factor of section 5 (`inferred_directions_unacted`). Status: built and operating (evidence: DOCTRINE-KERNEL.md map, live 2026-10-12).

### 25.3 Metrics and targets

[0142] Kernel metrics and targets: initiation_rate (decisions initiated without instruction / total; target 1); self_adoption_rate (target 1); friction_closure_rate (target 1); trust_compounding_rate (deposits / withdrawals), autonomy_velocity (d autonomy_rate / dt) and inference_accuracy (each non-decreasing); and, each with target 0, false_stop_rate, conditional_offer_rate, user_repetition_rate (instructions given more than once / total), question_rate (questions asked when the answer was yes / total reports), actor_assignment_rate (reports naming the principal as actor of a next action / total) and narration_rate (reports describing a change instead of producing it / total). Capability_acquisition_rate and doctrine_amendment_rate are recorded. The zero-target rates are the output of FIG. 16, computed from `false_stop_hits` over the denominators of agent outputs in the window, and each metric has a trigger (section 3) that files a work item on breach. Tick metrics include `tick_sequence_completion_24h`, `driver_drain_24h` and `trust_ledger_min`.

### 25.4 Fixed readings

[0143] "Fixed reading" means a recorded interpretation that travels with the kernel so that an agent reading it alone cannot misapply it. In one embodiment: the kernel describes how loops work and confers no authority; a document loaded into a loop without the commitments is rejected, but never the harness's instructions, permission checks or an owner override (always honored and recorded); "the affirmative displaces the negation" governs how work is reported and never whether a limit exists, so a refusal, an interrupt-eligible step or a line the agent will not cross is stated plainly with its reason; trust widens only the loop's own scopes; an interrupt-eligible, refused or claimed step is reported as exactly that, with owner and closing probe, which is a disposition and not a conditional offer; and the affirmative default carries its scope. Technical effect: a kernel that compels action carries explicit bounds, so applying it cannot disable the checks it is bounded by. Status: built and operating (evidence: DOCTRINE-KERNEL.md readings m through t, 2026-10-12).

### 25.5 Implementation map

[0144] In one implementation the tick runs as a ten-minute fleet tick with two producers, hourly remediation and metric ticks and hourly consumer steps (a loop breaker, a claim reaper, a continuity snapshot); the driver is `v_issue_queue_v2` (section 5) with pulls in `queue_pulls`; prediction and provenance use `decision_log`, `decision_predictions`, `calibration_scorer_tick`, `decision_outcomes` and `v_decision_calibration`; failure modes use `failure_modes` and `v_failure_mode_status`; trust uses `trust_ledger` and `trust_transitions`. Status: built and operating for these; the self-adoption gate and four-line reports in sessions are built, partially operating (a documented practice measured by section 25.3); the event weights of section 24.3 are prophetic.

## 26. Execution mandate and service levels

### 26.1 Decide-implement-deploy mandate

[0145] "Mandate" means a stored policy record, versioned like the kernel, that fixes an obligation of the system as a whole. In one embodiment the system is under a mandate that every accepted work item proceeds through four stages without stalling: DECIDE, IMPLEMENT, DEPLOY, VERIFY. A work item is in progress only if it is moving toward DEPLOY; a work item parked at decided or implemented locally is a violation. "Deploy" means live systemwide, across all affected workers, repositories, ledgers and surfaces, and not present on one host or branch. No stage is skipped and none is a dead end.

[0146] Per-step service level. Each stage of each process has its own time budget (a step with no budget is undefined and one is defined before it executes). A step-level breach files a work item automatically; a breach of twice the budget produces a single blocking question to the operator. No step is exempt: intake, triage, research, review, publish, deploy, verify and disseminate each carry a budget. The item-level tiers are retained (in one embodiment P0 under 4 hours, P1 under 24 hours, P2 under 72 hours, P3 under 7 days or deferred with rationale). Procedure for a step breach: at the tick, for each step row in `tick_runs` or in the process's ledger whose elapsed time exceeds budget B, if elapsed <= 2B file one work item keyed by (process, step); if elapsed > 2B and no blocking question is open for the (process, step), write one question card carrying the step, the elapsed time and the closing probe. Example (illustrative): with B = 4 hours, a review step at 5 hours files a work item and at 9 hours writes one blocking question.

[0147] Multi-path definition of done. Each process defines its definition of done (DoD) once, falsifiable and evidenced (a `close_evidence` field), and maps at least two independent paths to it: primary (canonical method), remediation (idempotent retry or fix when the primary fails) and workaround (alternate tool or route when remediation fails). All paths end at the same DoD at the same evidence bar, and a step with exactly one path is a gap to close. This is the process-level counterpart of the surface coverage of section 23.3.

Example record: `{process: "publish-report", dod: "page returns 200 and body contains report id; evidence stored", steps: [{name: "build", slo_min: 30, paths: [primary: builder, remediation: builder --clean, workaround: manual-assembly agent]}]}`.

[0148] Reconciliation with an immutability gate. In one embodiment an earlier policy requiring per-action explicit authorization is retained for its safety intent but removed for the mandated loop, which runs autonomously by default. Gates that continue to require approval and are never executed automatically: destructive or irreversible actions; external sends and paid calls; account-level, DNS and secret mutations; blast-radius caps, cost ceilings and kill switches. The surprise test ("would the principal be surprised that this changed?") becomes a post-hoc audit, and every autonomous mutation writes a run-ledger receipt and a read-back verification.

[0149] Falsifiability. The failure to avoid is rapid, low-visibility mutation that compounds before detection. Compensation: receipts and read-back on every path, kill-switch drills and the twice-budget escalation as a detection floor; the success metric is recurring operations needing a human per week, tending to zero, with zero unverified mutations.

[0150] Status: the mandate policy is adopted and active (evidence: PLCY/EXECUTION-MANDATE.md, version 1.0, 2026-10-17); the per-step service-level table, the automatic breach procedure and the process-definition records above are prophetic (not yet built), because the source states the policy and the compensation and shows no schema or operating evidence for them.

### 26.2 Fleet service levels and hard cap

[0151] In one embodiment a severity table sets time to resolution from the open date: SEV1 (system down, security, data loss) 24 hours; SEV2 (user-visible regression or wrong output) 72 hours; SEV3 (enhancement or backlog, the default for an agent's next-action rows) 7 days; SEV4 (optional or research) 14 days. A hard cap provides that no open register row carries a due date more than 14 days out, except calendar-bound items that fire on a natural schedule (for example a weekly report or a quarterly restore drill), external-event-gated items, and rate-limited drains rescoped to a running checkpoint (in one record, 329 records drained at about 18 a day). An acceleration rule pulls every other open agent-owned row beyond the SEV3 limit to that limit. Enforcement: a weekly audit verifies that each open row has a dated schedule trigger or a durable-job executor, and a view of items waiting on a human stays at zero.

[0152] Technical effect: a bounded due date turns an unbounded queue into a queue whose age is capped, and the executor-coverage check ensures every open row has a path to resolution that does not depend on a person.

[0153] Status: built, partially operating (evidence: docs/FLEET-SLA.md, 2026-09-06; the directive, tiers, cap and acceleration rule are stated and the audit row and the zero target for waiting-on-human items are named; the sweep above is an illustrative form and the source does not show it).

[0154] Alternatives: tiers in minutes for high-frequency processes; budgets learned from the 90th percentile of past step durations; escalation by a paging channel; per-path success rates feeding a process trust score, so that a frequently used workaround is itself a finding.

## 27. Fleet runtime: schedulers, executors and the closed operating loop (FIG. 18)

[0155] This section describes how the agent processes of the preceding sections are kept running without a person or a person's session. Terms used. A "fleet" means the set of independently deployable worker processes (each a serverless worker, container or job) that together implement the agents, loops and surfaces of the system. A "worker contract" means a checklist every fleet member satisfies so that the fleet can be enumerated and managed. A "scheduler" means a process that decides, from time alone, that a procedure is due and starts it. An "executor" means a process that carries out one task definition and writes a run record. A "run ledger" means the table of run records. A "tick slot" means one expected time-aligned firing of a scheduled procedure. Status of this section: built and operating for the worker contract, the dynamic dispatcher and executor, and the run ledger (evidence: qnfo-ops cloud/fleet-scheduler/worker.js v0.1.0 and cloud/fleet-executor/worker.js v0.3.0; docs/AUTONOMOUS-FLEET-ARCHITECTURE.md dated 2026-09-10); built, partially operating for two-scheduler redundancy (the two paths existed; the dynamic dispatcher and executor were later listed as retired in audits/2026-09-13-FLEETWIDE-PRODUCTIVITY-CONSOLIDATION.md, so redundancy was demonstrated before that date and is not asserted afterward); prophetic for the hot-standby and event-triggered variants of section 27.5, and for the promotion count of the autonomy ladder (section 9 supplies the ladder).

### 27.1 Topology

[0156] Referring to FIG. 18, scheduler A 1802 is the native cron trigger of the execution platform: each worker declares zero or more cron expressions, and the platform invokes the worker's scheduled entry point. Scheduler B 1804 is a dynamic dispatcher: one worker fired every minute that reads a `fleet_crons` table and starts due jobs, so that schedules can be added, changed or disabled by writing a row, without redeploying any worker. Both feed manager ticks 1806 (FIG. 3 and sibling loops). Manager ticks read and write a work ledger 1808; the work ledger is read by executors 1810; executors deploy through a deploy engine 1812, whose results are checked by probes 1814; probe results and run records are written to a signal store 1816; the signal store is read by the next manager tick (feedback) and by a dead-man check 1818 that raises an alert to the manager ticks when a tick slot has no record.

[0157] Technical effect. Separating starting (1802, 1804) from doing (1810) and recording (1816) means a stalled scheduler, executor or recorder leaves a different, detectable gap in the ledgers instead of a silent stop; and the dispatcher reduces a schedule change from a deployment to a row write.

### 27.2 Worker contract

[0158] In one embodiment every fleet member satisfies a worker contract with seven items: (1) a `VERSION` constant in semantic-version form incremented per deployment; (2) a `GET /health` route returning `{status, worker, version, enabled, bindings_ok}`; (3) a self-describing header (purpose, capabilities, deploy method, canonical source); (4) a canonical directory in a repository containing a copy of the deployed source so that repository and deployment can be compared byte for byte; (5) a row in a registry table (`service_registry`: name, purpose, kind, status, crons, dependencies, health URL, autonomy level, owner); (6) a list of secret names, never values; (7) kill-switch and autonomy flags readable from a key-value store or database. The registry is the only census authority; deployed reality is reconciled against it hourly, and each worker is in one state of `live`, `drifted`, `degraded`, `paused` or `retired`. A worker lacking a version is invisible to the drift comparison; in one measurement 27 of 79 deployed workers lacked a version (scan of 2026-09-09), and a report card of 2026-09-10 counted about 65 of 80 registry rows as not in semantic-version form (different scan definitions). Status: built and operating; the contract was specified as a target and was enforced only partly (evidence: AUTONOMOUS-FLEET-ARCHITECTURE.md sections 2.2 and 6).

### 27.3 Dynamic dispatcher

[0159] The dispatcher of scheduler B performs the following steps on each per-minute invocation. Step 1: read every row of `fleet_crons` where `enabled = 1` and (`next_fire` is null or `next_fire <= now`). Step 2: for each such row, compute the next fire time from the row's five-field cron expression, and insert a `fleet_runs` row with status `queued`, the task identifier, the cron name and the start time. Step 3: post `{task_id, cron_name}` to the executor. Step 4: record in `fleet_crons` the `last_fired` and the computed `next_fire`, whether or not the post succeeded, so that a failing executor does not cause the same job to be re-fired on every minute. A dispatch error is captured in the returned list and is visible as a run row that never leaves `queued`.

[0160] The next-fire computation is an example algorithm a skilled person can reproduce. A field matcher accepts a comma-separated list of terms, each being `*`, a step `*/n` (true when the value is a multiple of n), a range `a-b`, or a literal. The next-fire function starts at the beginning of the following minute and advances one minute at a time, testing minute, hour, day-of-month, month and day-of-week against the five fields, up to one year of minutes (366 x 24 x 60 = 527,040 iterations) and returns null if no minute matches. For example, `*/10 * * * *` called at 12:03 returns 12:10. Pseudocode:

```
function next_fire(expr, from):
  f = split(expr)               # minute hour dom month dow
  if len(f) != 5: return null
  t = floor_to_minute(from) + 1 minute
  repeat up to 527040 times:
    if match(f[0], t.minute) and match(f[1], t.hour) and match(f[2], t.dom)
       and match(f[3], t.month) and match(f[4], t.dow): return t
    t = t + 1 minute
  return null
```

[0161] Alternatives: a jump-ahead search; a cap of K jobs per invocation with carry-over; a deterministic stagger offset per job (in one measurement the fleet had 201 cron collisions per day, the worst being 15 at 06:00 UTC); a durable queue between dispatcher and executor. Status: built and operating for the per-minute dispatcher (evidence: cloud/fleet-scheduler/worker.js v0.1.0; AUTONOMY-REPORT-CARD-2026-09-10.md reports 99 dispatcher runs in 24 hours on that date); the stagger offset was set in configuration and the collision measurement is from the census of 2026-09-10; the other alternatives are prophetic.

### 27.4 Executor and run ledger

[0162] The executor reads a task row from `fleet_tasks` (`id`, `type`, `definition` as JSON, `enabled`) and runs it by type. A task of type `sql` runs one statement against a named database binding and returns the row count and the first three rows; `http` issues one request and returns the status and the first 500 characters; `ai` calls a model through a gateway with a model chosen from an allowed list (default the cheapest, per section 17) and a bounded token count (default 1,024); `workflow` runs an ordered list of such steps and returns every step result. Any other type is rejected. Run outcome is written to `fleet_runs`: the row inserted by the dispatcher (status `queued`) is updated to `running`, then `ok` with a result truncated to 4,000 characters, or `failed` with an error truncated to 1,000 characters; a manual invocation with no prior row inserts one. After each completion the executor builds an event envelope (schema version, kind, identifier, timestamp, provenance with emitter, session and a SHA-256 of the payload), validates it with a deterministic validator before writing, and stores it with status `accepted` or `rejected` and the validation error, so that a malformed record is rejected at write time rather than discovered at read time. A fuller run ledger specified in the architecture document has columns `run_id, worker, trigger (cron|http|event|manual), ts_start, ts_end, status, error_class, summary, evidence_refs, parent_run, cost`; the implemented `fleet_runs` table carried task_id, cron_name, status, started_at, finished_at, result, error. Status: built and operating for the executor and the subset ledger; the full eleven-column ledger is prophetic (specified, not evidenced as built).

[0163] Accounting invariant. For every batch of items an executor scans, the counts of items executed, failed, handed to a person and found to need no action sum to the number scanned: `executed + failed + needs_human + no_action = scanned`. A batch violating it is itself a failure. In one recorded case an executor self-report read "scanned 25, executed 0, failed 0, needs_human 0, no_action 0", twenty-five items unaccounted for, while eight tracked signals each showed one attempt, dispatch state `dispatched`, no verification, no closure, and 87 to 127 occurrences; the pattern was detect, dispatch once, never verify, re-detect (evidence: audits/2026-09-13-LOOP-EXECUTOR-ACCOUNTS-FOR-NOTHING.md). The invariant is the check by which that class of fault is found mechanically. Status: the invariant and the case are built and observed (the case is a failure story); automatic enforcement of the invariant as a gate is prophetic.

### 27.5 Redundancy of two schedulers and the dead-man check

[0164] Two scheduling paths are independent when they share no process and no table of next-fire state: in FIG. 18, 1802 keeps its state in the platform and 1804 in `fleet_crons`. A tick slot has a record when a `tick_runs` row (section 15) or a `fleet_runs` row with a start time inside the slot exists. The dead-man check 1818 performs: step 1820, for each declared recurring procedure compute the expected slots in the last window from its cron expression; step 1822, count records per slot; step 1824, a slot with zero records opens an alert work item naming the procedure, the slot, and which scheduler(s) declared it; step 1826, when both schedulers declare the procedure and exactly one produced a record, the alert is labelled a single-path failure and carries the lower priority of a degraded redundancy, and when neither produced a record it is labelled a stop and carries the higher priority. With two schedulers active a slot may have duplicate records; the manager tick takes a work claim (section 13) so the second firing ends without acting.

[0165] Worked example (illustrative). A tick declared as `*/10 * * * *` has 6 expected slots per hour. Scheduler A has records in all 6; scheduler B in slots 1, 2, 4, 5, 6. Slot 3 has one record, so no alert fires and B's reliability statistic is 5 of 6 = 83 percent. If both are missing in slot 4, the check opens a stop alert at step 1824; the work claim prevents double action in slots where both fire.

[0166] Alternatives for redundancy: three schedulers with majority; an active scheduler and a hot standby taking over when its heartbeat age exceeds a threshold; schedulers on different platforms; an external monitor calling the dead-man check's health route; event-triggered scheduling in which a record arrival is the trigger (the fleet's time-triggered coordination was scored 3.0 of 5 for that reason). Status: built, partially operating (evidence: native per-worker cron on 48 workers and the per-minute dispatcher coexisted on 2026-09-10 per AUTONOMOUS-FLEET-ARCHITECTURE.md Appendix A and AUTONOMY-REPORT-CARD-2026-09-10.md; no source records a measured failover between them). The slot-counting algorithm is a described embodiment, prophetic as a complete implementation; hot standby and event-triggered scheduling are prophetic (not yet built).

## 28. Signal-organism architecture: signals, boundary, triage and re-entry

[0167] This section describes a payload architecture that runs on the fleet runtime of section 27 and in which the outputs of the system re-enter as inputs. Terms. A "signal" means a record s = (time, source, content, weight), where the weight is an evidential weight stating what the signal licenses the system to believe; a record without a weight is treated as noise. An "artifact" means an output object having a type, an attribution and a deposit identity (for example a published document with a persistent identifier). An "open-question set" U(a) means the set of questions from a fixed audit list (in one embodiment 15 questions) that an artifact a does not answer. A "boundary" means the set of permitted (worker, source, domain) triples. "Re-entry" means converting a deposited artifact into a signal. The biological terms "organism", "sensing" and "metabolism" are used as names for data flows: sensing is intake (source to `signals`), metabolism is the conversion of signals to artifacts and their cost accounting, and immune memory is the retention of recurring failure signatures; each corresponds to a table and a worker below and none implies a biological process. Status of this section: the layer model and data model are specified (evidence: docs/SIGNAL-ORGANISM-ARCHITECTURE.md v1.0, 2026-09-12, marked active and canonical) and the migration steps that create the tables and deploy the loop worker were unchecked in that document; the layers other than L2 enforcement and L8 are marked active for the existing research pipeline. Accordingly: signal intake (L0), triage (L1), synthesis (L3), audit (L4) and deposit (L7) are built and operating; the boundary table (L2), re-entry (L8) and the strict-shrink acceptance rule (L5) are specified, built in part, and not evidenced as operating; the fitness threshold is prophetic.

### 28.1 Layers as data flows

[0168] The layers are: L0 intake into a proposals table; L1 triage (a weight and a decision of respond, log or ignore, from a two-model scorecard writing a research queue); L2 boundary confinement; L3 synthesis of a candidate artifact; L4 the ignorance audit; L5 refinement; L6 fitness; L7 deposit with attribution; L8 feedback in which the deposited artifact re-enters as a signal. Each layer reads the previous layer's output table, so the architecture is a chain of tables. L8 was motivated by a measurement: 19 artifacts had been published and none had re-entered, so the chain was a pipeline and not a loop.

### 28.2 Signal and boundary schema

[0169] In one embodiment two tables are used. Table `signals`: `id` (stable hash of source reference and time), `ts`, `source` (one of arxiv, zenodo, idea_proposals, d1_telemetry, email, fleet, artifact_reentry), `source_ref`, `content`, `open_questions` (JSON array), `evidential_weight` (real), `domain`, `status` (new, triaged, respond, logged, ignored), `decision` (ACCEPT, LOG, IGNORE), `score`, `created_at`. Table `signal_worker_boundary`: `worker`, `source`, `permitted` (integer, default 1), `domain`, `note`, primary key (`worker`, `source`).

[0170] Boundary enforcement algorithm, applied by a worker before it consumes a signal. Step 1: a worker presents the signal it intends to consume. Step 2: look up (worker, source, domain). Step 3: if no row exists the request is denied (default deny). Step 4: if a row exists with `permitted = 0` the request is denied. Step 5: otherwise permitted. Step 6: a denial is written as an incident and does not stop the worker's other work. An example seed: research workers may consume arxiv, zenodo, idea_proposals, research_queue and artifact_reentry; dissemination workers only zenodo and social_engagement, so that they promote deposited artifacts and never raw signals; personal-affairs surfaces only a personal source; operations surfaces only fleet and d1_telemetry. A cross-domain guard rejects a triple whose domain is not listed, so that a signal tagged for one research domain does not reach the claim path of a worker for another. Technical effect: confinement by lookup bounds which worker can read which data class, so a defect or injected instruction in one worker's input reaches only the sources its row permits; the predicted fall in cross-domain contamination is labelled untested in the source.

### 28.3 Re-entry rule

[0171] Re-entry runs as a scan with the following steps. Step 1: select artifacts that hold a deposit identity, whose distribution status is distributed or published, and whose identifier is not already present as `source_ref` of an `artifact_reentry` signal (the identifier is the idempotency key). Step 2: build the content as title, abstract, identifier and U(a); the open-question set is the payload because the unanswered questions, not the result, warrant a response. Step 3: if U(a) is empty or unrecorded, write the signal with weight 0 and status logged, and stop; recording U(a) at review time is therefore a prerequisite. Step 4: set the weight to a stored value, high for artifacts that were computationally verified and review-clean and 0 for artifacts that failed review; the weight is stored and is not inferred. Step 5: write the signal to `signals` with source `artifact_reentry`; it flows through triage like any signal, and triage scores the open questions. Step 6: a response (a follow-up or a revision) is accepted only if it strictly shrinks U, with a further guard that a shrinkage obtained by narrowing a claim is logged as a violation.

[0172] Worked example (illustrative values). An artifact with U(a) of 15 questions reenters with weight 0.8. A revision leaves 12 unanswered, strictly fewer than 15, and is accepted. A second revision leaves 12 and is not accepted. A third leaves 9 but a diff check finds two result-asserting paragraphs removed, so it is logged as narrowing and rejected. Technical effect: the acceptance rule makes the open-question count non-increasing across accepted revisions (true by construction per the source), and the guard addresses gaming of that count.

### 28.4 Fitness threshold

[0173] A signal is worth responding to when the expected reduction in open questions per unit of energy or effort exceeds a threshold. The threshold is a calibration parameter initialised to null; while null, triage falls back to the composite scorecard of L1. A numeric value is written only after an experiment shows that fitness-scored triage selects better signals than recency-scored triage. Alternatives: a threshold per domain; a bandit exploring below-threshold signals at a fixed share. Status: prophetic (not yet built); the source states that no numeric value is specified.

## 29. Wiring graph, producer-consumer maps and orphan detection (FIG. 19)

[0174] Terms. A "wiring graph" means a directed graph whose nodes are fleet members and stored resources and whose edges are declared bindings. An "edge" means one declared dependency of a worker on a resource or another worker, read from the platform's deployment metadata and not from documentation. A "producer-consumer map" means, for each stored table or queue, the processes that write it and the processes that read it. An "orphan" means a node or table with no declared consumer or no declared producer. An "island" means a worker with no service edge in either direction. A "sink" means a worker that is called by others and calls none, and a "source" means a worker that calls others and is called by none.

### 29.1 Wiring sweep

[0175] Referring to FIG. 19, a wiring sweep 1904 calls the platform scripts interface 1902 and, for each worker, records its cron expressions, routes, queue consumer bindings, and bindings by type. Binding types captured include relational database, key-value namespace, object bucket, vector index, queue, durable object, workflow, service binding (a direct worker-to-worker call carrying the target worker's name), AI binding, secret (name only) and text variable. The sweep writes the result to the wiring graph store 1906 (in one implementation a JSON file with the fields generated, account, worker_count, errors and a workers array, each worker having name, modified, usage model, compatibility date, crons, routes, queue consumers and bindings). A worker for which the interface returned an error is listed under `errors` and is excluded from the counts; in the recorded sweep one worker of 76 failed with a closed connection and 75 were captured.

[0176] Recorded values (sweep of 2026-09-09T13:38Z; computed from the stored file). Of 75 workers captured, 64 distinct service-binding edges existed; the largest binding counts by type were secrets 132, relational databases 103, service 64, AI 33, vector indexes 33 and object buckets 30. Thirty workers had no service edge in either direction (islands), 24 were sinks and 15 were sources. The most-called worker (an AI gateway) had 8 incoming edges, and an operations worker had the most outgoing edges (13). Four edges named a target not among the captured workers (the unresolved-target case: renamed, retired, or capture failed). That file held no cron expressions or routes (all zero), so the trigger layer came from registry rows (48 scheduled workers on 2026-09-10).

### 29.2 Graph analyzer and orphan detection

[0177] The graph analyzer 1910 reads the graph store 1906 and the registry 1908 and performs: step 1930, build the edge set of (caller, callee) pairs from service bindings; step 1932, compute for each node its in-degree and out-degree; step 1934, label a node an island when both are zero, a sink when only in-degree is nonzero, a source when only out-degree is nonzero; step 1936, label an edge target unresolved when it is absent from both the graph and the registry; step 1938, compute directed density as edges divided by n x (n minus 1); step 1940, compare the graph with the registry and report three drift counts: ghosts (in the registry and not deployed), unregistered (deployed and not in the registry) and unversioned (version not in semantic-version form); step 1942, write the result to an integration state table as a composite integration score with the counts.

[0178] Worked example from the report card. With 80 registered workers and 49 declared edges, directed density is 49 / (80 x 79) = 49 / 6,320 = 0.00775, which rounds to the recorded 0.0078; 42 islands and 16 sinks were recorded in the same reading, and the report card therefore described the graph as a sparse near-star in which most workers are un-integrated leaves. (The 49 edges of the report card and the 64 edges computed from the stored file derive from different capture dates and edge definitions.) Alternatives: weight an edge by call volume; add data-flow edges derived from the tables each worker writes and reads, so a worker connected only through a shared database is not an island; compute strongly connected components.

[0179] Orphan tables are found by joining each table's writer set and reader set from the producer-consumer map; a table with writers and no readers is a producer without a consumer.

[0180] Technical effect. Producer-without-consumer faults produced the dominant failure mode in one audit day: four instances, namely 75 proposed or approved improvement rows with no drain, 34 queued dispatch rows with zero state transitions and an attempts sum of 5, an issue drain that processed 21 items and closed 0, and the executor that scanned 25 and executed 0 (audits/2026-09-13-LOOP-EXECUTOR-ACCOUNTS-FOR-NOTHING.md; audits/2026-09-13-FLEETWIDE-PRODUCTIVITY-CONSOLIDATION.md). Detecting a table whose writer set is non-empty and reader set is empty converts a silent backlog into an item.

### 29.3 Fleet runtime census

[0181] A "fleet runtime census" means a table listing each fleet member with measured activity, so that idle members can be separated from unmeasured ones. In one embodiment a census table `fleet_worker_census` was created with 55 rows on 2026-09-13 from a daily activity table, and the audit stated a limitation: absence from the activity table means absence from the monitor's fixed roster and is not proof that a worker is idle; of 15 unmeasured workers, four answered a health probe with success. The census drives a consolidation plan: retire members dead for a period (for example 2 days) or that fire and fail, fold low-traffic hubs into a hub that already serves them, and measure first by extending the monitor roster to the unmeasured members before retiring any. The same audit recorded a monitoring collapse that the census was meant to catch: of 83 names in the probe log, 10 were fresh and 73 frozen at one identical timestamp, and 3,342 of 21,076 probe rows were HTTP 404, all for retired workers. Status of this section: built and operating for the sweep, the graph computation and the census (evidence: docs/fleet-architecture/wiring-summary.md generated 2026-09-09; the stored sweep file; the audits of 2026-09-13); the orphan-table join and data-flow edges are prophetic; the consumer map document existed as a companion file but was not among the sources read.

## 30. Fleet dashboard, SLAs and report cards

[0182] Terms. A "fleet dashboard" means a worker that renders the operational state of the fleet and exposes it as JSON. A "report card" means a dated record scoring the fleet on named dimensions against a named rubric, each score carrying evidence and a confidence. A "claim sheet" means a table in which each claim carries evidence, confidence and status, so that a score is not accepted without an evidence pointer.

### 30.1 Dashboard

[0183] In one embodiment the dashboard is a worker with three database bindings and a platform token, served on a dedicated hostname, refreshing every 90 seconds, with routes `/api/state` (raw JSON), `/api/refresh` (recompute) and `/health`. At a point in the record it reported 72 workers, 48 scheduled, 9 relational databases and 10 health probes; in the same period the registry held 80 rows with 79 live, and later versions reported 81 probes up. Its panels show 24-hour request and error totals from the platform's analytics query interface, per-scheduled-worker errors and next runs, audit panels (gateway failures, model health, definition-of-done register, scheduler state), and rows for jobs bound to a person's device, captured in the registry at deployment time. Pages and data sources are listed below.

| Page or route | Shows | Data source |
|---|---|---|
| `/` status page | counts, 24-hour requests and errors, chips (human-gated ops, self-heal actions, open agent issues, drift divergence) | `/api/state`; audit database; platform analytics query |
| `/api/state` | raw JSON of the above | same |
| `/api/integration` | registered, live, edges, islands, sinks, density, drift | integration state table; wiring graph |
| `/api/loop` | executor self-report: last execute time and scanned, executed, failed, needs_human, no_action | executor telemetry |
| operational card | decision authority, intelligence, viability, decision cycle levels | report card |
| `/health` | version, liveness | worker |

[0184] Recorded: 14,622 requests and 12 errors in 24 hours, an error rate of 12 / 14,622 = 0.082 percent; 9 of 9 flow chains ok. Recorded gaps: no per-worker run-success ledger, and registered probes pointing at hostnames returning 404, so unrouted-but-live workers were reported down. A later audit found the deployed version exposing `/api/loop` and the executor accounting fault of section 27.4. Status: built and operating (evidence: docs/fleet-dashboard/README.md; SYSTEMS-REPORT-CARD.md; audits of 2026-09-13).

[0185] Data flow of FIG. 19. The operational state API 1914 and the integration state table 1912 feed the report-card computation 1916; 1916 renders to dashboard pages 1918 and to owner digests 1920; both are read by the kaizen loop 1922, which dispositions the top gap rows into the work ledger and thereby causes new sweeps 1904. Owner-facing digests (a daily brief of state, a weekly report of trends and improvements) are produced from the same state, so the digest and the dashboard cannot disagree (axiom A3).

### 30.2 Service-level policy

[0186] A service-level policy converts open-row age into a rule. In one embodiment four severities carry a time to resolution counted from the open date: SEV1 blocker (system down, security, data loss) 24 hours; SEV2 regression (user-visible broken feature or wrong output) 72 hours; SEV3 enhancement or backlog 7 days (default for agent next-action rows); SEV4 optional or research 14 days. A hard cap states that no open row carries a due date more than 14 days out, except calendar-bound items on a natural schedule, items gated on an external event, and rate-limited drains re-scoped to a running checkpoint (for example 329 records at about 18 per day). Enforcement: a weekly audit checks that every open row has a dated trigger or durable executor, and the count of rows waiting on a person must remain 0. Algorithm: for each open row, due = min(due, open_date + sla(severity)); if the row is not exempt and due is later than now plus 14 days, set due to now plus the SEV3 cap; if the row is past due, raise its priority one level and notify the manager. Status: built and operating as a policy and a weekly audit (evidence: docs/FLEET-SLA.md, 2026-09-06); automatic recomputation of due dates by the algorithm above is the described embodiment, partly prophetic.

### 30.3 Systems report card

[0187] The systems report card scores the fleet against published rubrics for levels of automation, organizational viability, decision-cycle closure, self-adaptive loops, control-loop automation and time horizon. The live operational card has four rows: decision authority (a ten-level automation scale, recorded as level 5 when human-gated decisions are pending and 8 when human-gated operations are 0), intelligence (level 3 of 5, "agents"), organizational viability (systems 1 to 3 present, 4 partial, 5 external) and decision cycle (closed at 15-minute cadence). The detailed analysis scored dimensions by letter: verification and safety A, availability B, self-healing B+/A-, self-improvement C+, self-model C, independent thinking C, objective function C+, drift control D+, integration D+; the overall grade was B-. Each score has a claim, evidence, confidence and status; for example "about 5 of 8 loops closed" is marked medium confidence because it is inferred from receipt counts.

[0188] Objective function. The canonical operational objective is the triad: human-gated operations toward 0, drift divergence toward 0, and self-healing active (at least one action and no silent failure). A cycle is good when it moves the triad toward (0, 0, active). The expansion is a six-term scalar F = w1 x loop_closure_rate - w2 x drift_count - w3 x human_interventions - w4 x cost_overrun - w5 x integration_gap + w6 x throughput, where loop_closure_rate = closed loops / 8; drift_count = unversioned + ghost + mirror-drift; human_interventions = rows waiting on a person + date-gated migrations; cost_overrun = max(0, spend - 90 dollars per 30 days); integration_gap = islands + unregistered + declared-versus-actual mismatches; and throughput = publications + deploys + ideas. Illustrative arithmetic with weights all 1: 5 of 8 loops closed gives 0.625; drift 66 (65 unversioned + 1 ghost); human 0; overrun max(0, 9.596 - 90) = 0; integration gap 42; throughput 20 (illustrative): F = 0.625 - 66 - 0 - 0 - 42 + 20 = -87.375. Terms have different scales, so weights need calibration; the source states that they were uncalibrated and that F was not yet a single stored scalar; only the triad was operational. Status: triad built and operating; six-term F prophetic.

### 30.4 Autonomy report card

[0189] The autonomy report card scores ten dimensions from 0 to 5 with a named evidence pointer and a stated gap to the next point. Recorded scores on 2026-09-10: operations viability 4.0; coordination 3.0; control and audit 4.5; intelligence (sensing) 3.5; policy and identity 3.0; decision-cycle closure 4.0; self-healing 3.5; novelty generation 3.5; independent decision-making 2.5; watchmaker index (inverted, 5 meaning fully self-winding) 4.8. The overall score is the mean: (4.0 + 3.0 + 4.5 + 3.5 + 3.0 + 4.0 + 3.5 + 3.5 + 2.5 + 4.8) / 10 = 36.3 / 10 = 3.63, reported as 3.6 of 5. Cited evidence included 9 of 9 flow chains ok, 81 of 81 probes green and 42 of 79 workers being islands.

[0190] Computation and use. The dimensions are used as set-points of a homeostasis loop: re-scored on a monthly cadence by a dated register row; a dimension that falls by 0.5 or more without a documented cause becomes a kaizen candidate; the kaizen loop dispositions the three largest gap rows per cycle. The card also codifies a residual consent boundary of three classes (irreversible external actions in which the principal is the identity actor; destruction of the principal's personal data without a rollback; and changes to the objective function, which the system may propose but not adopt), consistent with section 9. The card records its own limits, including self-measurement bias (the system grades itself), rubric mismatch (rubrics designed for vehicles, people or organizations applied by analogy) and point-in-time evidence, and it states that a top score would be unsupported by the evidence (anti-sycophancy: the top row is reported as a gap row). Technical effect: scoring each dimension against evidence pointers, with a stated confidence and a rule that an unexplained 0.5 drop opens work, converts a subjective self-assessment into a quantity that drives the work ledger and can be audited later; the improvement recorded in the same document (a one-cycle reduction of open agent issues from 83 to 1 and of probes from 2 to 81 of 81 healthy) is evidence that the card's gap rows were actionable. Alternatives: scores computed only from tables; scores from an independent auditor of a different model family. Status: built and operating as a dated self-assessment (evidence: docs/AUTONOMY-REPORT-CARD-2026-09-10.md); automated monthly recomputation from tables is specified and its operation after 2026-10-10 is not evidenced here.

## 31. Objective space and self-authored goals (FIG. 20)

[0191] The baseline describes managers that originate work inside a charter (section 5, step 314). This section describes how the system originates its own goals, above the level of work items, without altering the objective that the principal set. The problem addressed is that an organization run by agents either never proposes anything beyond its charter, which leaves the principal as the only source of direction, or it rewrites its own objective, which is silent objective drift. The mechanism below separates instrumental goals, which the system may author and adopt, from the objective itself, which the system may only propose to change.

[0192] Definitions. "Objective" means a terminal statement of purpose or an objective function (for example a mission and weights over metrics) ratified by the principal. "Ratified objective" means an objective row written by the principal or by a ratification action of the principal and never written by an agent. "Goal" means an instrumental statement of what to do next (a subgoal, project or priority) that is falsifiable, reversible, and evaluated against a ratified objective. "Derived goal" means a goal adopted by the system with a recorded parent ratified objective. "Novel goal" means a goal that no ratified objective anchors and that therefore enters probation. "Objective space" means the set of ratified objectives (standing), derived goals, and novel goals on probation, held in one record set so that a reader can see which statements direct the system and with what authority.

### 31.1 Records

[0193] In one embodiment the objective space comprises three tables. The `objectives` table holds ratified objectives and is writable only by a seed routine written as insert-if-absent and by a ratification action. The `goals` table holds authored goals. An `objective_space` view or table presents the union with a tier column.

```sql
CREATE TABLE objectives (
  id TEXT PRIMARY KEY, kind TEXT,            -- 'mission' | 'objective-function'
  statement TEXT, version INTEGER, status TEXT,  -- 'ACTIVE'
  ratified_by TEXT, ratified_at TEXT);
CREATE TABLE goals (
  id INTEGER PRIMARY KEY, statement TEXT,
  goal_type TEXT,           -- 'instrumental' | 'objective-revision'
  parent_objective TEXT,    -- NULL only for novel goals
  alignment TEXT,           -- why the goal serves the parent
  score REAL, priority INTEGER, dod TEXT,   -- definition of done, falsifiable
  program_code TEXT, owner TEXT,
  status TEXT,              -- proposed | adopted | active | probation | superseded | retired
  adopted_at TEXT, retired_at TEXT, retire_reason TEXT);
```

[0194] Status: built and operating (evidence: SELF-AUTHORED-GOALS.md, worker `qnfo-goal-author` live 2026-09-14, hardened 2026-09-15; DOCTRINE-KERNEL.md map, `objective_space` live 2026-10-12). The columns `ratified_by`, `ratified_at`, `retire_reason` and status `probation` are illustrative extensions.

### 31.2 Authoring cycle (steps 2002 to 2028)

[0195] An authoring worker runs on a schedule (in one implementation daily at 02:00 UTC, a cron expression `0 2 * * *`). In one embodiment it performs these steps, which correspond to the numerals of FIG. 20.

[0196] Step 2002: gather signals. The worker reads, bounded and defensively, the objectives, then candidate signals from idea proposals, self-questions, autonomy score gaps, self-heal actions, general signals, and, in an embodiment, rows of an inferred-direction table (section 34.4). Each read is bounded (for example 50 rows) and a failed read yields an empty set, not an aborted cycle. The first recorded cycle gathered 24 signals.

[0197] Step 2004: synthesize candidates. A model-backed agent is asked for goal statements that are falsifiable, each with a definition of done that a probe can check. Only the answer field of the model response is read; reasoning text is not. Fenced JSON is stripped before parsing, and an empty answer emits a warning receipt so that a silent model failure is visible. In one implementation a non-reasoning model replaced a reasoning model that returned an empty answer under a small token limit and had left a think loop silently dead for several days.

[0198] Step 2006: classify. Each candidate is typed `instrumental` or `objective-revision`. A candidate that would change the mission, the weights of the objective function, or the boundary of residual consent is an objective revision. At step 2008 every objective revision is written with status `proposed` and owner equal to a principal-ratification owner and is never adopted by the authoring worker; a code branch short-circuits any attempt to give it status `adopted` or `active`. When the count of queued revisions is above zero the worker emits an event of kind `objective-revision-proposed` with status pending ratification, so the principal queue (section 14 of the baseline) shows it.

[0199] Step 2010: score and de-duplicate. Each instrumental candidate receives a score in [0, 1] from falsifiability, leverage and novelty. In one embodiment score = 0.4 x falsifiability + 0.4 x leverage + 0.2 x novelty, each factor in [0, 1] (the weights are illustrative). A candidate whose score is below a threshold (for example 0.5) is rejected at step 2012 with its score recorded. A candidate is also rejected when its token set A has Jaccard similarity |A and B| / |A or B| at or above 0.6, or containment |A and B| / min(|A|, |B|) at or above 0.6, against any goal adopted in the last 30 days. Worked example (illustrative): a candidate of 10 distinct tokens sharing 6 with a 14-token adopted goal has Jaccard 6 / 18 = 0.33, below 0.6, but containment 6 / 10 = 0.6, which meets the threshold, so a reworded duplicate is rejected although a Jaccard-only test would admit it. This containment test closed a failure in which the next daily cycle produced a reworded duplicate that an exact-hash test missed; after the change a cycle reported four near-duplicates and adopted only distinct goals.

[0200] Step 2014: anchor. The worker looks for a ratified objective that the candidate serves, by a stem match of the statement against the objective's statement and the program's keywords. A stem expression is used rather than a whole-word expression, because a whole-word expression for "topolog" failed on "topological". A candidate with a parent is adopted at step 2018 as a derived goal with `parent_objective`, an `alignment` sentence and a definition of done. At most N goals (for example 3) are adopted per cycle, highest score first. In the first recorded cycle 6 candidates produced 3 adoptions (scores 0.7, 0.8, 0.9), 0 queued revisions and 3 rejections, and the objectives were unchanged.

[0201] Step 2016: probation. A candidate that passes the score test but has no anchor is a novel goal. In one embodiment it is stored with status `probation` and a review deadline (for example 14 days), it is not dispatched to executors with write authority, and a metric (in the implementation named `objective_space_novel_overdue`) counts novel goals past their deadline. A novel goal does not reduce the objective space; it makes visible a direction the principal has not ratified. At step 2024 the principal (or a delegated ratification role) ratifies or declines. A ratified novel goal at step 2026 becomes standing: it is written into `objectives` by the ratification action and may anchor later goals. Raising the objective space in this way raises trust for the surface (in the kernel, an event "objective space extended" adds 0.05, section 9 of the baseline). A declined or overdue goal goes to step 2028.

[0202] Status for step 2016 and 2026: built, partially operating. The kernel implementation map records `objective_space` with standing, derived and novel probationary tiers and the overdue metric as live from 2026-10-12; no source shows the authoring worker itself writing novel goals, so the writer of probationary rows is an embodiment not yet shown operating. Steps 2002 to 2014, 2018 and 2028 are built and operating.

[0203] Step 2018 and linkage. Adoption also writes a row to a drainable ledger so the goal has a consumer. In one implementation the row is written to `task_dod_register` with `source_table = 'self_authored_goal'` and a due date 90 days out; the autopilot census reads rows where `status = 'open' AND due <= today`. Before this linkage goals sat in a register no worker read and were inert (a recorded failure). A research-type goal is additionally written to a research queue with source `goal-author`, decision `ACCEPT` and status `queued`, from which a triage worker claims it through to publication (step 2020; one such goal was recorded as queued for execution).

[0204] Step 2022: retire. At each cycle and on request the worker re-prioritizes and retires. A goal is retired when its definition-of-done probe passes, when it has been active longer than a stale limit (for example 14 days) without evidence, or when a newer goal supersedes it. Retirement sets `retired_at`, a `retire_reason`, status `retired` or `superseded`, and cancels the goal's ledger rows, so that no goal leaves the active set without a disposition (silent drop, baseline definition). In one implementation near-duplicate goals were marked superseded with ledger rows cancelled; the health endpoint then reported 11 goals, 8 active and 8 drainable.

### 31.3 Guards and alternatives

[0205] Guards. The mutation endpoints of the authoring worker require a shared token header and return an unauthorized status without it; the scheduled path is unaffected. The honesty invariants are enforced in code: (a) the objectives table is never mutated by the authoring worker; (b) an objective revision cannot reach an adopted status; (c) an adopted goal has a non-empty parent and alignment. A value-proposal loop runs weekly (in one implementation `0 3 * * 1`) and authors proposed revisions of the objective function under the ratification queue; three proposals (weights and a constraint) were recorded. Adoption of those revisions remains with the principal.

[0206] Technical effect. The system obtains new, ranked, de-duplicated work at a bounded rate (3 adoptions per daily cycle in the example) without either a human authoring step per goal or any path by which the objective is altered by an agent. The implementation's autonomy assessment recorded independent decision rising from 2.5 to 4.0 out of 5 and policy proposal from 3.0 to 3.5, and declined a higher score because autonomous adoption of values is the failure the design prevents.

[0207] Alternatives (prophetic). (1) Anchoring by embedding similarity against the objective (threshold, for example 0.75) in place of stem matching. (2) A probation tier that auto-ratifies a novel goal after a named metric improved over a control window, never ratifying an objective revision. (3) Per-tier adoption caps, for example 3 derived and 1 novel goal per cycle. (4) Per-program authoring with the program charter as parent. (5) Ratification by a quorum of a board.

## 32. Work breakdown structure and agent protocol (FIG. 21)

[0208] A work breakdown structure gives every unit of work an address that persists across sessions, agents and storage systems. Definitions. "WBS code" means a dotted identifier of the form `<portfolio>.<program>.<project>.<phase>[.<task>[.<subtask>]]` (for example `QNFO.ADL.002.P4` for portfolio QNFO, program ADL, project 002, phase P4). "WBS item" means a work item (baseline definition) carrying a WBS code or a roadmap identifier, an owner role, one or more trigger identifiers, a done check and a milestone. "Trigger" means the identifiers of other items, or a named gate, that are done before the item is ready. "Hand-off" means a recorded change of the responsible role for an item.

### 32.1 Addressing and plan convention

[0209] In one embodiment the program level is a controlled vocabulary of codes (7 in the implementation, after 45 project repositories were consolidated on 2026-08-04), each with a repository, branch prefix and plan prefix. Branches follow `{program}/{type}/{slug}` with a lowercase program code and a work type from a fixed list (paper, audit, artifact, infra, fix, kaizen), for example `ump/paper/adelic-shannon-theory`. A phase is one of ten codes P0 to P9 (initiation through extension). A version update or extension reuses the program code with a new project number or with phase P9.

[0210] Every step of an agent's plan is prefixed by the full code to phase level in square brackets, one code per step, followed by a verb and description; the plan step status (pending, in progress, completed) reflects the state of the item, not an anticipated state. A step with a code that is absent from the registry is a defect (anti-pattern: guessing a code without a lookup).

[0211] Resolution algorithm (executed by a processor when it meets a code). (1) Parse program, project, phase. (2) Select the registry row where `wbs_code` equals the program and project prefix, reading `program_registry` columns wbs code, phase, current version, status, knowledge-graph node identifier and update time. (3) Load the project plan, a version file and artifacts. (4) Query the knowledge graph for neighbors (what the item depends on) and for impact (what depends on it). (5) Compare the version file with `current_version`; on mismatch flag the item for reconciliation before execution. (6) Execute with a coded plan. After execution, verify by re-selecting the registry row, confirming that the item has an edge and dependents carry a DEPENDS_ON edge, and that the plan reflects actual status; a storage claim without a re-select after insert is a "phantom claim".

[0212] Status: built and operating (evidence: WBS-AGENT-PROTOCOL.md, 2026-08-04, authority record ADR-2026-007; PROJECT-MANAGEMENT.md, 2026-08-05 deployment of labels and templates).

### 32.2 Pipeline, propagation and subagent hand-off

[0213] A pipeline loop selects each registry row with status `active` and phase below P9, generates a coded plan for the next phase, executes it, then writes the phase and update time. A version mismatch is flagged for a P9 extension, and a dependent of a newer neighbor is flagged for propagation. Cross-project propagation is a coded plan: a dependent project receives steps for detect, impact, update, rebuild and republish, each coded `P9.T<n>`.

[0214] Hand-off. When a main agent delegates, the prompt carries the WBS code so the subagent can bootstrap its own context, and the role is typed: an explorer (survey and gap analysis, phase P1 or P2), an implementer (produce the artifact, phase P3 to P5) and a reviewer (red-team audit with line references, phase P4). A hand-off is recorded as a change of role in the item and carries the item's code, trigger identifiers and done check. In an embodiment the hand-off is a row in a claims table (section 13 of the baseline) so a second doer cannot take the same item.

### 32.3 Item state machine (FIG. 21)

[0215] FIG. 21 shows the lifecycle of a WBS item. The states and transitions are as follows.

[0216] Step 2102: Backlog. An item is created with an identifier, an owner role, trigger identifiers, a done check and a milestone. In the implementation's issue labels this is `status:backlog`. At step 2104 a processor evaluates the trigger: the item is ready when every trigger identifier names an item in state Done (or a gate that is open). If not, the item moves to Blocked (2116) with the blocking identifier recorded; if yes, to Ready (2106).

```
function evaluate(item):
  for t in item.triggers:
    s = state_of(t)                 # items by id, or a named gate
    if s not in ("done", "open"):   # gate open means its condition passed
      return block(item, blocked_by=t)
  return ready(item)
on done(x): for each y where x in y.triggers: evaluate(y)   # step 2122
```

[0217] Step 2108: In progress. A doer in the owner role claims a Ready item; the claim has an expiry (for example 24 hours without a recorded action) after which the claim is released and the item returns to Ready. An item whose next step is identity-bound (baseline definitions) leaves the doer path and is placed in the principal queue (2120) with a default, a reason and a closing probe. Step 2110: Review. The doer asserts done and hands the item to a reviewer role with evidence; the reviewer is a different executor, and in one embodiment of a different model family. Step 2112: the closing probe named in the done check is run. A pass moves the item to Done (2114) with evidence stored and, in the roadmap embodiment, a plus proposed. A failure returns the item to In progress (rework) and increments a rework counter; an item with a rework count at or above a threshold (for example 3) is escalated as a root-cause item (baseline section 6).

[0218] Step 2118: Superseded or cancelled. An item leaves the active set only as done, superseded or cancelled, each with a reason; a Blocked item whose purpose has been replaced goes here. This implements the rule that nothing drops silently. Step 2122: on Done, items that name this identifier as a trigger are re-evaluated; a Blocked dependent whose triggers are all Done moves to Ready, with the dependency edge providing the order.

[0219] Status for FIG. 21: built, partially operating. The state labels (backlog, in progress, review, blocked, done), the roadmap's identifier, owner, trigger, done-check and status fields, and the coded plan convention are in use; automatic re-evaluation of dependents on Done as written in pseudocode above is an embodiment, whereas in the implementation a manager read the trigger column of the roadmap on each tick. Claim expiry and rework threshold are illustrative.

### 32.4 Alternatives

[0220] (1) States held as labels on a mirrored tracker, or in a database with a transition log row per change (`from_state`, `to_state`, `at`, `by_role`, `evidence`). (2) Dependencies held as DEPENDS_ON graph edges queried by impact, so propagation reaches transitive dependents. (3) Several triggers combined by AND (default) or OR. (4) A time trigger (for example a 12-month conversion deadline with reminders at 90, 60 and 30 days).

## 33. Project management practice

### 33.1 Canonical store and public mirror

[0221] In one embodiment the canonical state of programs, projects and tasks lives in a relational database and a public project board mirrors it. The synchronization direction is database to board, never board to database, except by explicit principal action. Synchronization runs on events: a phase transition, a status update, a publication, a session closeout, or a sprint review.

[0222] Sync algorithm. (1) A state change is written to the database (phase, status, or a distribution state). (2) The processor checks whether the record has a mirrored issue. (3) If yes, the issue's labels, milestone and body are updated; if no, an issue is created from a template matching the record type. (4) A sync label (`d1:synced`) is added. (5) A row is written to an audit table. Not synchronized: comments, reviews, board column positions and star or fork counts, which are live collaborative state or external metrics. Label mapping: a program label maps to a program code (`program:ump` to `UMP.001`), a status label maps to a database status (`status:done` to a complete distribution status), and a milestone maps to a date-bound sprint or release.

[0223] The label taxonomy of the implementation has 39 labels in 7 groups (program, type, priority, phase, status, distribution, sync), deployed to each of 7 program repositories, with 5 issue templates (research paper, audit or review, infrastructure task, bug report, epic) that apply labels automatically (for example `type:infra` and `status:backlog`) and carry checklists. Status: built and operating (evidence: PROJECT-MANAGEMENT.md v1.0, 2026-08-05).

[0224] Technical effect. A single canonical record with a one-way mirror avoids split-brain edits of status, and the audit row lets a reader reconstruct what was mirrored and when.

### 33.2 Milestones, stalled projects and definition of done

[0225] Milestones. A milestone is a named, ordered group of items that share an urgency or a gate. In the roadmap embodiment (section 33.3) there are four: Now (this week), Next (after the item's trigger), After filing (items gated until a disclosure event), and Later. An item's milestone changes only on the item's own state change or by a manager's recorded action. A gate label (for example `gate:filed`) places items in the gated milestone until the gating item is Done; the first public-facing items wait until a filing event so that publication does not precede protection.

[0226] Stalled project. The baseline risk formula counts S stalled projects (section 5, paragraph [0037]). In one embodiment a project is stalled when it has open items, no item changed state in the last D days (for example 14), and no claim is held. A stalled project adds 2 to the risk value and raises the verdict to AMBER. Worked example (illustrative): a program with H = 1, O = 12, G = 0 and S = 2 has risk 3 x 1 + 0.3 x 12 + 15 x 0 + 2 x 2 = 3 + 3.6 + 0 + 4 = 10.6. A manager's response is a recorded action: reassign the doer, split the item, set a trigger that explains the wait, or supersede.

[0227] Status for the stalled-project predicate: prophetic as a stated D-day rule; the count S is built and operating in the risk view (baseline).

[0228] Definition of done. A done check is falsifiable and has evidence. In one embodiment "done" requires that tool calls ran, output was observed, and the output matches a stop condition; "verified" requires an independent path to reproduce the result with evidence stored. Each process defines its done check once, then maps at least two independent execution paths to it: a primary path, a remediation path (retry or fix, idempotent) and a workaround path (an alternate tool or route). All paths end in the same done check at the same evidence bar; a step with exactly one path is a single point of failure. A done check that was never observed leaves the loop open (a predecessor effort stalled because a compiled model runtime never had its first response confirmed). Status: built and operating as policy (evidence: PLCY/EXECUTION-MANDATE.md; DOCTRINE-KERNEL.md definitions).

### 33.3 An organization's roadmap as work items

[0229] The system's own launch plan is expressed with the same work-item shape. Each roadmap row has an identifier (for example GH-1, IP-5, WEB-2), a title, an owner role, a trigger, a done check, a milestone and a status. The roadmap file is the source of truth; a generator writes one JSON file per row (37 in the implementation) with fields `id`, `title`, `body` (owner, trigger, done check, status), `labels` and `milestone`, and a label list (role labels such as `role:ops`, workstream labels such as `ws:patent`, a gate label and a `plus` label). A script creates labels, milestones, issues and project boards from the files. Milestone counts in the implementation: Now 10, Next 14, After filing 6, Later 7.


[0230] Rules recorded with the roadmap: the record is files in version control and not chat (items not in a repository do not exist); a status change is a commit to the roadmap and the issue state, and the two agree; a closed item files a `plus` issue (20 percent of each cycle is reserved for accepted pluses); items that only the principal can do (accounts held by the principal, signing, spending, the legal entity) are marked, each with what the system prepares so the principal's part is a click, a signature or a decision, and the short list of such items is kept in order of when they matter. Nine items were on the principal's short list; the trigger column makes their order computable (for example GH-2 waits on GH-1 and IP-5 on IP-4). An item leaves the file only as done, superseded or cancelled, with the reason.

[0231] Status: built and operating (evidence: docs/roadmap.md drafted 2026-11-10 and docs/issues/*.json, 37 files). Mirrored issue creation on a hosted tracker is prophetic for this tenant at the draft date, because the source states the repositories did not yet exist and the creation script had not run.

[0232] Technical effect. A plan expressed as items with trigger and done check lets a processor compute ready work (section 32.3), render the principal's queue with its minimum steps, and diff a plan generated by bootstrapping (baseline section 19A) against a hand-written one field by field.

## 34. Suggestions, experiments, roadmap proposals and inferred direction

### 34.1 Suggestion engine

[0233] "Suggestion" means a short candidate input (a question, a technical field, an example) shown to a user of a surface before or while the user types. A suggestion engine serves one surface from sources scoped to that surface's domain and filters every candidate on the server.

[0234] Algorithm (research-question surface). (1) Welcome mode: build two groups. Recent questions: live human threads ranked by message count and recency, junk and domain filtered, de-duplicated. Frontier questions: a curated starter set rotated by day. (2) Prefix mode: when the user types, after a debounce (for example 320 ms), match the prefix against thread titles, then content, then the frontier set; fall back to recent and frontier. (3) Domain gate: apply to every candidate a deny list, a deny-word expression and a command-shape expression covering personal-assistant and operations words; a prefix that is itself an operations word returns only domain-safe defaults. (4) Return titles, identifiers and scores only; load bodies on selection. The gate is enforced in the server, because a client-side filter can be bypassed and the payload is the control.

[0235] Algorithm (intellectual-property drafting surface). Sources: metadata of an idea bank and a vector index of prior filings. (1) With an empty query return a small rotating set (for example 4) of examples with light metadata. (2) With a query of at least 3 characters, embed it and return the top 5 similar filings for style grounding. (3) Technical-field completions map internal folder labels to standard field names. (4) When the top similarity is at or above 0.80, a prior-art closeness warning is returned with the draft and shown as a banner; the warning is a style reference, not clearance.

[0236] Status: built and operating (evidence: SUGGESTION-ENGINE-RD.md, wave of 2026-09-03; research surface version 2.7.0 to 2.7.2; drafting surface 3.4 to 3.4.2; verification by live probes, a banned-token scan). Items in the source's backlog, including per-visitor adaptive ranking, click analytics feeding a bandit, and section-aware retrieval, are prophetic.

[0237] Bandit embodiment (prophetic). Each suggestion is an arm. For arm i with impressions n_i and clicks c_i, the engine draws a sample from Beta(1 + c_i, 1 + n_i - c_i) and shows the arms with the highest draws, with a floor of one exploration slot in the group. Illustration: arm A with 3 clicks of 40 impressions has mean 4/42 = 0.095; arm B with 0 of 5 has mean 1/7 = 0.143 and a wider spread, so B is shown more until its impressions grow. The reward is a successful ask, not a click alone.

[0238] Technical effect. Server-side domain scoping keeps a public surface from leaking operations content, and prior-art similarity alerts a user to a close existing filing before drafting.

### 34.2 Experimentation program

[0239] "Experiment" means a registered comparison of a treatment against a control on a named outcome metric over a fixed window. A registry table holds `id`, `name`, `hypothesis`, `kind`, `treatment`, `control`, `outcome_metric`, `baseline_date`, `status`, `owner` and `created_at`. A statistic table holds daily counts per exact path (`date`, `slug`, `requests`). A third table records per-post engagement. Kinds: content framing, version freshness, topic selection, writing style, and message framing, timing and subject lines.

[0240] Measurement rules. (a) Honest signal only: a platform's own invocation counts are self-health and are not cited as external traffic; honest signal is exact-path requests net of scanner traffic or an external record view and download count. (b) Aggregate over N: when a single signal is too small to reach significance, at least two independent signals are combined or the window is extended. (c) No fabrication: results are read from the stores. (d) Social tests follow platform and anti-burst rules. (e) Same window: treatment and control are measured over identical calendar windows.

[0241] Worked example from the recorded baseline. On 2026-09-01 the treatment page had 3 requests per day and the control 4. Over a 14-day window under a Poisson assumption the counts are about 42 and 56. The standard error of their difference is sqrt(42 + 56) = 9.9, and the observed difference of 14 is 1.41 standard errors, below 1.96, so even a 33 percent difference would not be significant on that single signal in 14 days. This arithmetic is why rule (b) exists. Detecting a 50 percent lift from 4 per day at 80 percent power needs about (1.96 + 0.84)^2 x (4 + 6) / (4 - 6)^2 = 19.6 days (illustrative Poisson approximation).

[0242] Stop rules. In one embodiment the program stops an experiment on the first of: (1) the window closes (the source specifies a 14-day close with a keep or adapt decision); (2) a guard metric breaches (for example an honest-traffic drop in both arms or an etiquette violation), which stops it at once; (3) futility, in which the sample needed for the target power exceeds a cap (for example 60 days); (4) an operator stop through a configuration row. Adaptation rule: a lever with a positive honest-signal delta on at least 2 metrics is promoted to standard practice for its surface; a neutral or negative lever is dropped with a rationale written to the registry. Rules (2) to (4) are illustrative.

[0243] Status: built, partially operating (evidence: EXPERIMENTATION-PROGRAM.md, 2026-09-02). The registry and statistic tables were live; four experiments were registered (version freshness and social message framing running, posting time planned, an outreach subject line scheduled to start 2026-09-15); the weekly digest ran on Monday mornings; no source reports a completed readout in this chapter's material.

### 34.3 Roadmap proposal and trusted sources

[0244] Section 5, step 314 of the baseline describes a daily origination of one roadmap proposal per program under a threshold of open items. This subsection adds the validation path. A proposal is parsed from fields TITLE, WHY, code-task, code-anchor and EDIT; it is rejected unless (a) the target path is outside control-plane, governance and separated-plane paths, (b) the anchor is at least a minimum length (for example 20 characters) and occurs exactly once in the target, and (c) a proposal with the same normalized title is not open or closed in the last 30 days. A validated proposal becomes a work item whose `source` is on a trusted-source list; the list determines whether the item may take the merge-on-green and canary deploy path, while an item of any other source requires review. A daily cap bounds origination. A plus is reversible by construction and uses the reserved 20 percent of capacity; a roadmap proposal is sized as a feature. Status: built and operating for the proposal path described in the baseline; the numeric validation limits shown here are illustrative.

### 34.4 Inferred direction from revealed preference

[0245] "Revealed preference" means a direction inferable from choices the principal made and avoided, as distinct from stated objectives. "Inferred direction" means an objective-weighting derived from revealed preference. The system keeps an `inferred_direction` table and a tick step that updates it before the queue is pulled.

[0246] Algorithm. At each tick (step "update inferred direction", ordered after recognition and before the queue pull) the processor counts, for each issue category, the items filed by the principal in the last 7 days. A category with 2 or more such items is written as a row with a confidence. In one embodiment confidence = min(1, 0.1 x count), so that 2 filings give 0.2 and the queue score is multiplied by (1 + 0.2), which matches the worked example of the baseline execution queue (paragraph [0042]). Rows leave when the 7-day window no longer holds 2 items. The inference changes order only; it does not raise authority, change a limit, or alter a ratified objective.

[0247] Feedback. When an item in an inferred category is completed, the trust ledger records "inference acted on correctly" (+0.05) if the principal does not reverse it, and "inference misread" (-0.10) if the principal reverses or removes it, in the weights of the kernel. A metric counts inferred directions with no pulled item (`inferred_directions_unacted`), so that an inference that the driver does not use is visible. A repeated, stable direction is also an input to goal authoring (step 2002): it can seed a candidate that is then classified and anchored as in section 31.

[0248] Worked example (illustrative): in 7 days the principal files 3 items in `site` and 1 in `patent`. `site` has confidence 0.3 and `patent` no row; a `site` item with base score 18 becomes 18 x 1.3 = 23.4.

[0249] Status: built and operating (evidence: DOCTRINE-KERNEL.md implementation map, rows `inferred_direction` and `objective_space` live 2026-10-12, and the queue view that reads direction); the confidence formula and the feedback to goal authoring are illustrative or prophetic as stated.

[0250] Technical effect. The system aligns its work order to the principal's behavior without a questionnaire and without granting itself authority, which reduces principal prompts and keeps the signal inspectable as rows with a 7-day expiry.

[0251] Alternatives (prophetic). Revealed preference may be drawn from items the principal closes or reopens, edits to agent output, or gate cards approved quickly; categories may decay exponentially (for example half-life 3 days) in place of the 7-day window; a board embodiment may compute direction per member and require agreement of two.

## 35. Cost-optimized routing stack (FIG. 22)

[0252] This chapter extends the cost-aware model ladder of section 17 with the rung definitions, task-class rules, escalation conditions, caps and measurements that make it implementable. Terms: a "task class" means a named category of work (for example classification, extraction, digest synthesis, agent loop with tool calls, code writing, reader-facing drafting) for which one capability test and one validation rule are defined. A "rung" means one entry in an ordered list of ways of producing an answer for a task class, from no model call at the first rung to a frontier model at the last. A "capability canary" means a short deterministic test run against a model for a task class that returns pass or fail. "Cost per verified outcome" means the spend attributed to a task divided by the number of tasks of that class that passed their validation gates (cost_usd divided by ok), as distinct from cost per token. "Resolved upstream" means the model that actually served a request after any alias, router or gateway indirection, as logged per request.

[0253] Technical effect. Spend on a model-backed fleet is dominated by repeated context and by retries, not by the price per token of any single call. Routing by capability first and price second, with a deterministic verifier deciding escalation, lowers the cost per verified outcome without lowering the pass rate, and a fleet-wide cap with a free fallback prevents a budget breach from stopping work.

### 35.1 Rung definitions

[0254] In one embodiment the ladder has eight layers, descended in order, each entered only when the layer above cannot answer or has failed a measured check (steps 2204 to 2222 of FIG. 22).

| Layer | Name | Rule | Step of FIG. 22 |
|---|---|---|---|
| L0 | Deterministic handler | If the answer is computable (a SQL query over the ledgers, a regular expression, a probe, a static lookup, a template fill), compute it and make no model call | 2204, 2206 |
| L1 | Cache | Exact response cache with a time to live and invalidation on source change; key-value exact match for idempotent queries; semantic cache with a cosine threshold; reuse of stable prompt prefixes billed as cached input | 2208, 2210 |
| L2 | Capability gate | Keep only models whose canary passed for the task class; price is a tiebreaker, never the gate | 2212 |
| L3 | Cascade | Free tier first, then a cheap paid model, then a frontier model; move to the next rung only on a measured failure | 2218, 2220, 2222 |
| L4 | Ensemble | Sample N answers or propose-then-aggregate, only when components are free or cached | within 2218 |
| L5 | Distilled specialist | A small model or exemplar bank trained offline on trajectories from a frontier model for a recurring class | rung rows of 2212 |
| L6 | Draft then verify | A cheap model drafts; a frontier model repairs only when deterministic checks fail | 2218 to 2222 |
| L7 | Budget scheduler | Daily per-tier caps, an organization ceiling, a stated degradation order and a free fallback on cap hit | 2214, 2216 |

[0255] Status: built, partially operating (evidence: COST-OPTIMIZED-ROUTING-STACK.md, created 2026-09-26, section 5 implementation table). In that table L0, L1, L2, L3, L4, L7 and context economics were each recorded as partial, L5 (distillation) and L6 (draft-verify) as absent, and the measurement view of cost per task as not yet built. L5 and L6 are therefore Status: prophetic (not yet built) in this specification, and the persisted capability matrix of L2 was a recorded gap at that date.

### 35.2 Capability before price

[0256] The capability gate (step 2212) rests on a measured observation: an agent or coding loop requires valid structured tool calls, and a cheaper model that does not emit them costs more through retries and truncation than the model it replaced. In one implementation four candidate models were recorded as not emitting tool calls for the operations agent loop while one cheap model did, so that routing by price alone silently broke the loop. The system therefore keeps a capability matrix keyed by (model, task class) holding a pass or fail result per canary (tool-call validity, schema conformance, context size) and routes only to models that pass. A suitable schema is:

```sql
CREATE TABLE model_task_matrix (
  task_class   TEXT NOT NULL,
  rung         INTEGER NOT NULL,        -- 0 = no model ... n = frontier
  model        TEXT NOT NULL,           -- resolved upstream identifier
  unit_cost    REAL NOT NULL,           -- per 1K input/output tokens, 0 for free tier
  canary_tool_calls INTEGER,            -- 1 pass, 0 fail, NULL untested
  canary_schema     INTEGER,
  ctx_tokens   INTEGER, max_out INTEGER,
  agreement    REAL,                    -- section 37 label agreement, NULL if not a gate model
  admitted_at  TEXT, probed_at TEXT,
  PRIMARY KEY (task_class, rung, model));
```

[0257] Selection algorithm (steps 2212 to 2218). The router reads the rows for the task class with all canary columns equal to 1 and agreement at or above the class gate where one applies; orders them by rung; and selects the lowest rung. Alternatively selection may weigh unit_cost against a measured pass rate (expected cost per verified outcome equals unit_cost times mean tokens divided by pass rate) rather than using rung order.

### 35.3 Cascade, verifier and escalation rules

[0258] In one implementation the cascade order was a free tier model served first for the operations path, then a cheap paid model, then a frontier model. Escalation (step 2222) is triggered only by a measured signal recorded in the attempt row: a schema or validator failure, a tool-call parse failure, empty content, truncation by length, or a confidence below a threshold. A deterministic verifier is what keeps the cascade cheap, because code can be verified by tests, schema validators and unit checks without a second model call. Pseudocode:

```
route(task):
  if det = handler(task.class): return det                 # 2204, 2206
  if hit = cache.get(key(task)) and not hit.invalidated:   # 2208, 2210
       return hit
  rungs = matrix.passing(task.class)                       # 2212
  r = 0
  loop:
    if cap_breached(task.class) or cap_breached(ORG):      # 2214
         r = max(r_free_if_any, r_cheaper(r)); log(step_down)   # 2216
    out = rungs[r].run(task)                               # 2218
    if verify(out, task.class): break                      # 2220
    attempts += 1
    if attempts > MAX_RETRIES or r == last: fail(task); return
    r += 1                                                 # 2222
  record(cost, task, r, attempts)                          # 2224
```

[0259] Example parameters: MAX_RETRIES of 2 per task; escalation only by one rung per failure; a failed task is filed as a work item rather than retried indefinitely. Alternatives: self-consistency voting among 3 to 5 free samples; escalation by a learned router in place of rules.

### 35.4 Caps, graceful degradation and the free fallback

[0260] Cap logic (steps 2214 and 2216). Each task class and the organization have a daily cap and a monthly ceiling, enforced both by the router (a count of spend in the gateway log joined by task) and by the platform gateway (a spend limit). The degradation order is: serve from cache; step to a free tier; step to a cheaper paid rung; queue the task for the next window. A paid-path failure or a cap hit does not end a task while a free path exists. In one implementation the gateway carried a monthly spend limit of 200 (currency units as stated in the source doc) and a daily cost-per-impact guard performed detect, act and verify. The code-only specification of section 38 cites a different limit (90 per 30 days), so cap figures are configuration and are examples.

[0261] Guard against inverted guards. A cost guard is installed only after the resolved upstream of the path it guards is probed, because a guard whose target is dearer than the status quo raises cost. In one incident on 2026-09-26 a gate that would have downgraded a free path to a paid model was caught by this rule before it shipped. No routing or cost change ships without a same-turn probe of the logged resolved upstream rather than the model constant in code.

### 35.5 Context economics and measurement

[0262] Observed live, repeated contexts of 130,000 to 270,000 tokens dominated input cost, with some at 400,000 to 540,000. Levers in order: stable-prefix caching billed as cached input; compaction of old turns; structured conversation state in the relational database with a summary re-injected in place of raw history; retrieval of relevant slices instead of full context; and a bounded size on every tool result. Technical effect: input tokens per round stop growing with turn count. Measurement is by task class, joined on the gateway log (columns including upstream_model and job_id): cost per verified outcome; escalation rate (share of tasks reaching the frontier rung); cache hit rate; tool-call validity rate. A per-model health table records probe status. Status of the measurement view: prophetic as to the cost-per-task view; built as to the logged columns (evidence: same document, section 4).

[0263] Worked example (illustrative). A class has 100 tasks. A cheap model costs 0.002 per task and passes 60; a frontier model costs 0.02 per task and passes 98. Cheap-only cost per verified outcome is 0.2 / 60 = 0.0033 but leaves 40 failures. Cascade: 100 cheap attempts cost 0.2; the 40 failures go to the frontier rung and cost 0.8, of which 39 pass; total 1.0 for 99 verified, or 0.0101 per verified outcome, against frontier-only 2.0 / 98 = 0.0204. The cascade halves cost per verified outcome in this example and escalation rate is 0.40.

## 36. Model floor and model standards gate (FIG. 23)

[0264] "Model floor" means a minimum capability standard that a model must meet before it may be routed to a class of work, enforced by a scan of source and deployed artifacts. "Model standards gate" means a minimum-parameters standard (context window and maximum output) applied to every model advertised to or configured by any client, with a registry of exemptions. "Banned class" means a named family or size class of model excluded from the floor. Both standards are enforced by guard programs, so that a purge of a disallowed model is not reverted by a concurrent deployment.

### 36.1 Model floor

[0265] Rule. A model that writes or executes code, or that produces reader-facing output, is required to be of a frontier class; no small, legacy, distilled sub-frontier, small mixture-of-experts or quantized fast variant is used for any purpose, including diagnostics. In one implementation the rule was adopted 2026-09-11. The banned list named one open-model family across five generations, several small base models, several 26B to 32B coder and distilled models, and any low-rank-adapted or quantized-fast variant; the approved list named four code models, three general models and a relay family treated as frontier scale. A comment mentioning a banned model for history is permitted if its line carries a marker string.

[0266] Justification measured in the field. A 70B-class quantized fast model used by a paper reviser to audit published research invented named living mathematicians as authors of work absent from the supplied source; fabricated attribution is the highest-cost failure in a publication pipeline and in outreach to real researchers. Separately the primary code and tool path of a router targeted a 30B mixture-of-experts model with about 3B active parameters while a frontier code model in the catalogue was unused; such a model does not hold a deep iterate-and-repair loop.

[0267] Enforcement algorithm (a guard run on the guard cadence). Step 3602: enumerate repository sources of every worker and fetch the live deployed bundle of every worker through the platform API. Step 3604: strip comment-only lines and declarations of the banned list itself, and skip lines with the marker. Step 3606: match each remaining line against the banned patterns. Step 3608: exit 0 if none match, otherwise exit 1 and file a work item per worker with the matching line. Canonical case: on 2026-09-11 an audit found 10 workers with live code-level banned models, including a router and an agent gateway; earlier one-off purges had been reverted by concurrent redeploys because nothing checked. Status: built and operating (evidence: MODEL-FLOOR-1.md, 2026-09-11, guard program named model-floor-guard).

### 36.2 Model standards gate

[0268] Rule. Every model advertised to or configured by a client carries maximum output at or above 32,768 tokens and a context window at or above 128,000 tokens, except an operations executor whose context floor is above 64,000 (actual 1,048,576). A model that cannot meet the floors is retired from the catalog or registered in an exemption registry with per-model evidence of the platform-native cap. Silent noncompliance is a hard finding. The registry in one implementation held entries such as a 24,000-context, 16,384-output model; two 32,768-context, 16,384-output models; an 80,000-context model with compliant output; a vision model with 4,096 output; a short-form advisor limited to 350 requested tokens; and an embedding model.

[0269] Verification recipe (steps 3610 to 3616). Step 3610: for each server, read the health version and fetch the deployed bundle, then search for the constants for default maximum output, answer cap, reasoning output cap and model context. Step 3612: for each client store (provider settings file, a database table of model configurations, a backup of a chat client's configuration), read back per-model maximum output. Step 3614: run the catalog guard, which compares each catalog entry to the registry with floors ctx >= 128,000 and maxOut >= 32,768 and checks that every internal model appears. Step 3616: record a claim sheet row (claim, evidence, confidence, status). Truncation was found on both server and client layers, so all layers are verified after every model change. In one run the server constants were: default and answer maximum output 65,536, tool round and tool result caps 32,768, relay clamp 32,768, model context 1,048,576. A cap-halving retry reduces a requested ceiling by half when the platform returns a 400 and a context-aware target keeps requests in range; /v1/models advertises honest values only. Status: built and operating (evidence: MODEL-STANDARDS-GATE.md, audit 2026-09-08, changelog entries through red-team round 2).

[0270] The exemption registry of 2026-09-08 lists models (for example a 30B mixture-of-experts and a 32B coder) that the floor of 2026-09-11 bans; the later floor supersedes those entries.

### 36.3 Minimum capability per task class

[0271] The floor and gate define a lower bound across all classes; the capability matrix of section 35.2 defines the bound per class. In one embodiment a model is eligible for a class only if it is above the floor, meets the gate (or is exempt for that class with evidence), has passed the class canary, and for a class used as a gate on the organization's decisions has met the agreement threshold of section 37. Illustratively: drafting and code writing, frontier class only; classification and extraction, any admitted model; agent loop, only a model with a recorded tool-call pass.

## 37. Fleet calibration and model admission (FIG. 23)

[0272] "Calibration of infrastructure" means scheduled self-generated probe traffic that measures latency and availability and adjusts configuration within an allowlist. "Calibration of predictions" means comparing the confidence stated by predictions with their realized hit rate. "Calibration of model decisions" means comparing a decision model's per-question answers with the organization's own labels. "Agreement" means the fraction of labelled questions on which the model's answer equals the organization's label.

### 37.1 Infrastructure calibration and stress testing

[0273] In one implementation a calibrator worker ran three schedules: daily at 03:00 UTC, a weekly stress run (Sunday 03:30 UTC, the daily set plus an adversarial input battery, 8-way burst concurrency and plan-weight tuning) and a monthly run (04:00 on the first, the stress run plus retention cleanup of 90 days of metrics, 30 days of resolved anomalies and 7 days of calibration objects). The static probe set covered 8 HTTP probes through service bindings and public sites, the relational database, the object store and the vector index. A missed schedule is recorded as a schedule gap and the next fire recovers. Tables fleet_cal_runs, metrics, baselines, anomalies, actions, learnings and state hold results; probe traffic is self-generated and never counted as external usage.

[0274] Self-checks. Each run writes a verdict_score from completeness, integrity and plausibility checks with audit_json; a simulate mode injects an extreme input to show the detector fires. Each probe retries once. Baselines are exponential moving averages with variance-adaptive thresholds (illustratively, EMA mean 120 ms and deviation 15 ms give a threshold of mean plus 3 deviations, 165 ms; a 240 ms run is an anomaly). Autonomous adjustments are limited to an allowlist of reversible, binding-only actions (tune-threshold, tune-plan, publish-config, retention-cleanup); each has before and after JSON, is verified on the next run, and is reverted with an audit row and a learning if the metric regressed. A real anomaly auto-resolves when its probe is clean; a simulated anomaly is resolved manually after verification. Evidence: on 2026-09-04 a daily and a stress run each scored 1.0, all adversarial cases survived, a simulated anomaly was detected at severity high, and a real vector-probe anomaly auto-resolved after a fix. Status: built and operating (evidence: FLEET-CALIBRATION.md v1.0.0, runs of 2026-09-04).

### 37.2 Calibration of predictions and decisions

[0275] Prediction calibration (extends section 8). Predictions stored in the decision-prediction ledger carry a stated confidence p. At scoring, group predictions into confidence bins (for example 0.5 to 0.6, ... 0.9 to 1.0) per decision type and compute for each bin the hit rate h. Calibration error is the count-weighted mean of |p_bin - h_bin|; a Brier score is the mean of (p - outcome)^2. Illustrative arithmetic: if 40 predictions in the 0.8 to 0.9 bin (mean 0.85) were matched 28 times, h = 0.70 and the gap 0.15 lowers the confidence cap applied to that decision type by 0.15. Technical effect: stated confidence that gates autonomous action is replaced by an empirically corrected one. In the baseline implementation 1,056 predictions were scored with 73 percent matched (section 21), which is an aggregate hit rate, not a binned calibration; the binned computation is Status: prophetic (not yet built).

[0276] Decision-model calibration (extends section 17). A decision model that returns a probability per answer may be used as a gate only after the pipeline of FIG. 23 shows its agreement with the organization's labels at or above a gate for the class. In one implementation a candidate decision model agreed with the labels in 0.17 of cases against a gate of 0.7 and was not adopted for that task. For context, random answering among k options agrees with probability 1/k, so 0.17 is near the random rate for six options (illustrative).

### 37.3 Model-admission pipeline

[0277] The pipeline runs per (candidate model, task class) and is the sole path by which a row enters model_task_matrix. Step 2302: a candidate model is proposed, by a person, by a capability scan or by an escalation analysis. Step 2304: the floor check of section 36 (not banned, context and output limits met or exempt); failure is rejected at step 2306 with the reason recorded. Step 2308: capability canary (tool-call validity, schema conformance, context size) against fixtures of the class. Step 2310: label agreement check: draw a stratified sample of N questions from the organization's labelled store (for example N between 100 and 500; fewer than 30 is insufficient and the check returns inconclusive), obtain the model's answer per question, compute agreement as matches divided by N and a lower confidence bound (for example a Wilson 95 percent bound). Step 2312: the gate compares the lower bound with the class gate (example range 0.6 to 0.85; 0.7 in the one measurement). Failure is step 2314: the model is rejected for that class, the measured agreement is stored and it may still be admitted for other classes. Success is step 2316: a rung row is written. Step 2318: monitoring, by scheduled canaries, baselines of section 37.1, a shadow sample in which a fraction (for example 5 percent) of production decisions is also labelled by a person or the stronger rung to compute rolling agreement, and cost per verified outcome. Step 2320: if rolling agreement falls below the gate minus a margin (for example 0.05), if the canary fails twice in a row or if the floor list changes, step 2322 demotes or removes the row, routing reverts to the next passing rung, an audit row records the reason, and the model may re-enter at step 2302 after a change.

```sql
CREATE TABLE model_admission (
  id INTEGER PRIMARY KEY, model TEXT, task_class TEXT,
  stage TEXT,            -- floor|canary|agreement|admitted|demoted|rejected
  n INTEGER, agree REAL, lower_bound REAL, gate REAL,
  decided_at TEXT, reason TEXT, evidence TEXT);
```

[0278] Alternatives: agreement per question class; admission by a second-family judge where labels are scarce, with a human check on a sample; cohort rollout at 1 percent, then 10 percent of traffic; a gate on calibration error in place of agreement. Status: built in part (floor guard, standards guard, canary probes, agreement check observed once: evidence MODEL-FLOOR-1.md, MODEL-STANDARDS-GATE.md and section 17); the persisted matrix, shadow sampling and demotion step are Status: prophetic (not yet built).

## 38. Executors, code-only mode and per-executor trust

[0279] "Executor" means a process or person that carries out a dispatched work item and writes its result to the ledgers. "Executor adapter" means a module presenting an executor of any kind through one interface. "Code-only execution mode" means a routed mode of an agent endpoint in which a model is restricted to writing, running and verifying code with a restricted tool set. These elements keep the principle of section 20 that no step waits for an interactive session.

### 38.1 Executor worker and scheduler

[0280] In one implementation a scheduler worker and an executor worker implement dynamic scheduling in two components. Scheduler tick (per-minute schedule): step 3802, read from a table fleet_crons (columns name, task_id, cron_expr, enabled, next_fire, last_fired, updated_at) every enabled row whose next_fire is null or not later than the current time. Step 3804: compute next_fire by scanning minute by minute (up to 366 days) for the next time at which each of the five fields of the expression matches, where a field supports lists, ranges, a star and step forms such as */5. Step 3806: insert a fleet_runs row (task_id, cron_name, status queued, started_at). Step 3808: call the executor with task_id and cron_name; a dispatch error is returned in the tick result. Step 3810: update last_fired and next_fire. Executor (POST /run): step 3812, load the enabled row of fleet_tasks (id, type, definition as JSON); step 3814, find the latest fleet_runs row for the same task and cron name and set it running; step 3816, execute: a task of type workflow runs its steps in order, and a step is of type ai (model call through a gateway, with a model tier chosen from three named tiers, value, standard and premium, defaulting to value, and output stored to 2,000 characters), sql (a statement against a named database binding, returning the row count and a sample of 3) or http (a request with the response body kept to 500 characters). Step 3818: write status ok or failed with a result or error (result kept to 4,000 characters). Step 3820: emit an event envelope (schema version, kind, identifier, timestamp, provenance with emitter, session and a SHA-256 of the payload) that a mini-validator checks before write; a rejected envelope is stored with its error and status rejected in an events table, and the run response is wrapped in the same envelope.

[0281] Technical effect: a task is added, disabled or retimed by a database write rather than a deployment, every execution has a ledger row, and a malformed record is rejected before the canonical store. Failure cases: a dispatch error leaves a row at queued status and is only returned in the tick result; and because the executor updates the latest run row by task and cron name, two overlapping runs of the same task can contend for one row. Mitigations: a section 13 claim before dispatch and a reaper for stale queued rows. Status: built (evidence: scheduler version 0.1.0 and executor version 0.3.0 source files; the codeparse validation is labelled a pilot in the executor header; operating history is not stated in the source, so Status: built, partially operating).

### 38.2 Code-only execution mode

[0282] Rule. An endpoint that serves chat, operations and code from one route can instead classify each request as code, ops or chat and route it, so that code requests are served by a model with a code-only contract and code toolset while the other traffic is unchanged. In an audit of 1,390 logged requests, code execution was invoked 79 times of 2,582 tool invocations (3.1 percent), and 97 percent of traffic was operations introspection, a memory pipeline, chat and content creation, so a global code-only gate would break the memory pipeline, the conversation compressor and the main agent.

[0283] Classifier (step 3822). A deterministic function with no model call, applied to the last user turn and never to injected system context (which would label every request of some clients as code). Code signals are weighted and threshold-gated: explicit intent phrases (run, write a function, implement, fix this code, debug, refactor, write a test, deploy, commit); code artifacts (code fences, import statements, keywords, file extensions); and an explicit domain hint in the body or a header. Ops signals are tool and resource names. The default is chat. Bias rule: when evidence is ambiguous, the class is ops or chat, because a code request misrouted to ops still works and the converse breaks the memory pipeline. Router (step 3824): code goes to a code-only prompt, a code model and the code toolset; ops goes to the existing prompt and the full operations toolset (31 tools in the source); chat goes to the general path without tools. The class is logged to a domain column of the request log for every request.

[0284] What an executor may do in code mode (contract C1 to C8, summarized). It returns executed results first with at most a one-line summary; it executes only on the server side, using a sandboxed runtime and a virtual file workspace, and never emits code, shell commands or tool-call payloads for the client to run; it loops plan, write, run, verify and report in one turn without asking permission; its tools are limited to run-code, workspace read, write, list and delete, repository read, file write and pull request, and web fetch and search, with operations tools excluded; every claim of done carries the actual output as evidence, and an error is reported with its exact text; it states at least one concrete failure mode; execution is bounded, and long or CPU-heavy work goes through an asynchronous job path. Sandboxing: all execution occurs in isolated serverless runtimes at no marginal cost and the workspace is an object-store backed virtual filesystem, so no local machine is touched and a client such as a phone that cannot run code is still served. No-interactive-session operation: because the executor never hands work to the client, the mode runs from the scheduler, the queue and the claim ledger without a person present.

[0285] Verification probes (step 3826): a canonical arithmetic request returns the exact product 83,810,205 with finish reason stop and no client-side execution; a code-shaped prompt returns domain code, the code model and executed output with no prose; a memory-pipeline prompt returns domain chat; an ops prompt returns domain ops; and the domain column is populated after each probe. Rollout: implement in place with no new endpoint, verify the probes, watch the domain distribution for 48 hours, then expand the toolset. Fallback ladder: a free code model, a paid code model, a general frontier model. The source states that code-model quality against a frontier standard and classifier precision were unmeasured. Status: prophetic (not yet built) for the classifier and router (evidence of drafting: CODE-ONLY-EXEC-MODE.md, draft 2026-09-12); built and operating for the server-side-only enforcement that the draft recorded as already landed, with zero hybrid-family rows since 2026-09-09.

### 38.3 Executor adapters behind one claim ledger

[0286] "Adapter interface" means the functions an executor kind implements so the dispatcher and ledgers treat all kinds alike: describe() returning capabilities, supported task classes, model, cost class and trust key; claim(item) taking a claim per section 13; run(item) returning a result envelope with evidence; and report() writing outcome, cost and duration. Kinds: (a) an open model on the platform, driven through a tool loop of the worker of section 38.1; (b) a hosted coding agent that opens pull requests, mapped by an adapter that creates the work as an issue with the doer line and takes a claim on the path; (c) an interactive session of a person or a coding assistant, which acts only as a normal claimant and which no scheduled step waits for; (d) a container executor running the same worker code under a job scheduler. All kinds write through the canonical change path of section 12, so the claim fence rejects a stale holder whichever kind it is. In the baseline implementation more than 400 changes were merged by a hosted coding agent and more than 600 by the system's own code loop, coordinated through one claim ledger (section 21). Status: built and operating for the hosted-agent and own-loop executors (evidence: the section 21 counts as of 2026-11-10); the uniform describe/claim/run/report interface is Status: prophetic (not yet built).

[0287] Dispatch (step 3828): the dispatcher reads queue items in priority order, filters adapters whose describe() lists the class and whose trust key is at or above the item's required rung, orders them by cost class and dispatches the first available. If none qualifies, the item stays queued with a reason; it is not handed to the principal unless identity-bound.

### 38.4 Per-executor trust

[0288] Section 9 keys trust by (surface, action class). Per-executor trust adds the executor as a third key, an option noted in section 9, so a new model or agent starts at the prior and earns scope on its own record. Schema: executor_trust(executor_id, surface, action_class, ok, fail, trust_score, ladder_position, refreshed_at). Computation: trust_score = (ok + 5) / (ok + fail + 10) as in section 9. Worked example (illustrative): a new open-model executor with ok 6 and fail 2 on (repository, merge) scores 11/18 = 0.61, autonomous rung for that pair, while the same pair for a long-running executor with ok 30 and fail 35 scores 0.467 and its merges take the added-review path. The effective rung for a dispatch is the minimum of the executor rung and the (surface, action class) rung, so a trusted executor does not widen a distrusted surface. A model removed at step 2322 has its executor rows frozen, not deleted, so history is preserved. Alternatives: a lower confidence bound; decay toward the prior while idle; trust transferred between model versions of one family at a discount (for example half the counts). Status: prophetic (not yet built), the per-pair ledger on which it builds being built (section 9).

## 39. Audit-and-act procedure with verification, correction and capstone documents (FIG. 24)

### 39.1 Terms

[0289] "Audit-and-act procedure" means a repeatable procedure in which an agent process reads live state of a managed system, records numbered findings, acts on findings that survive re-testing, and records the outcome of each action. "Finding" means a record having an identifier within the audit, a claim about the managed system, the evidence for the claim (a query, a probe result, or a source-file hash, with the time at which it was read), a falsifier (an observation that would show the claim false), and a state. In one embodiment the state is one of `open`, `verified`, `corrected`, `retracted`, `pending` and `closed`. "Verification document" means a document that re-tests each finding of an earlier document by a path independent of the one that produced it. "Correction document" means a document that supersedes a named part of an earlier document, states what was claimed, what test showed it wrong, and what still stands. "Retraction" means a correction document that withdraws a finding in full. "Capstone" means a document that states the structural cause shared by several findings. "Measured clock" means a timestamp read from the managed system in the same statement or call that produces the evidence, as distinct from a clock value assumed or inferred by the agent.

[0290] Status: built and operating (evidence: `docs/FLEET-ERROR-AUDIT-2026-09-13.md` and its eleven companion documents, `audits/2026-09-13-*.md`, 2026-09-13).

[0291] Technical effect: because each finding carries a falsifier, is re-tested by an independent path, and is superseded by a dated document rather than overwritten when wrong, the audit trail reports the error rate of the audit itself, and downstream actions (closing tickets, deploying, retiring workers) are taken only on findings that reproduced.

### 39.2 Procedure

[0292] FIG. 24 shows the procedure. At step 2402 an audit agent reads live state of the managed system: for example database queries over alert, event, issue, queue and probe tables, service-binding health probes, and file hashes of canonical source against deployed source, together with a clock read from the database (for example `strftime('%Y-%m-%dT%H:%M:%SZ','now')`). At step 2404 the agent writes one numbered finding per claim, with evidence, falsifier and state `open`. A first audit may carry headline population counts that separate populations the alert stream conflates (for example 931 alert rows from one source, 3 open issues, and 12 of 55 workers probed healthy with 43 never probed).

[0293] At step 2406 a verification document is written, by the same or another agent, that re-tests each finding by an independent path, and is named by ordinal (for example `VERIFICATION-2` to `VERIFICATION-13`). The independent path is chosen so that a shared fault cannot produce the same answer: a source claim against live database state; a database claim against a second table or a service-binding probe. At step 2408 the verification document sets each finding to `verified` (the claim reproduces) or to a not-reproduced result. A finding that does not reproduce proceeds at step 2410 to a correction document or retraction, which names the superseded section, quotes the claim, states the control experiment that falsified it, and lists claims that are unchanged. The original document is not edited; both remain, so that the history of what was believed is retained.

[0294] A finding that reproduces proceeds at step 2412 to action: a source patch, a tombstone file that removes a shadowing source, a dispatch to an executor, an annotation of a record in place (the original value preserved in the `reason` column with a flag appended), or a change to a registry. At step 2414 the realization gate of section 40 tests whether the effect of the action was observed in the managed system. When it was not (the action exists only in a repository or in a staged patch), step 2416 sets the finding to `pending`, records the deciding query and the earliest time at which it can decide, and returns to step 2406 to re-test at that time. When it was observed, step 2418 writes a capstone that groups findings by structural cause and checks the cause against independent rosters (section 42.3). Step 2420 feeds the failure modes found into the failure mode register and the silent-drop reconciliation of FIG. 25, and the loop returns to step 2402. A correction document also reaches step 2418, because a retraction changes which causes the capstone may assert.

### 39.3 Document schema

[0295] In one embodiment each document is a Markdown file under version control with a header (`Date`, `Supersedes`, `Scope`) and tabulated findings; a database embodiment stores rows:

```sql
CREATE TABLE audit_finding (
  audit_id TEXT, finding_no TEXT, claim TEXT NOT NULL, evidence_query TEXT,
  evidence_read_at TEXT,            -- measured clock
  falsifier TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open',
  superseded_by TEXT,               -- document path + section
  PRIMARY KEY (audit_id, finding_no));
CREATE TABLE audit_document (
  path TEXT PRIMARY KEY, kind TEXT CHECK (kind IN
    ('audit','verification','correction','retraction','capstone')),
  supersedes TEXT, created_at TEXT);
```

### 39.4 Worked examples from one audit session

[0296] The following examples are taken from the audit of the QNFO fleet on 2026-09-13 (an audit session of a hosted coding agent with read access to the fleet's relational database). They are included because each shows a distinct way in which the procedure detects a fault in the managed system or in the audit itself. Where a claim was later withdrawn, both the claim and its withdrawal are given.

[0297] Example A, alert storm and its undeployed fix. Finding H1: one worker (`qnfo-pipeline-ops`) accounted for 931 alert rows all-time and 72 in the 24 hours to 14:08Z, every one reporting that it filed nothing. The hourly counts for the day were 6, 5, 2, 7, 4, 7, 3, 6, 5, 7, 5, 4, 4, 4, 3 (sum 72). Canonical source declared version 0.5.5 with alert deduplication; production still emitted the earlier wording. The verification document tested the claim directly: canonical source created a table `pipeline_state` at the top of each run, a query for that table returned `no such table`, and therefore the deployed build predated the fix. The cadence of 2 to 7 per hour independently excluded both later behaviors (alert only on a new ticket; re-notify at most every 6 hours).

[0298] Example B, the monitor that was claimed silent and was not (retraction). An audit document claimed that the dashboard worker that writes `fleet_probe_log` had stopped at 14:16:31Z, missed four consecutive `*/15` cron fires, and left a 69-minute blackout. The retraction states the cause: the agent read an attachment header `15:16 (UTC+02:00)` and treated 15:16 as UTC; the true time was 14:30:10Z, so every elapsed figure was inflated by two hours. The real gap was 13.5 minutes, one normal interval. A test fixed the record: a GET to the dashboard's refresh route advanced `fleet_dashboard_state.updated_at` from 14:16:39.546Z to 14:30:00.350Z and added 20 probe rows. The correction rule that followed is the measured clock of step 2402: a time-based claim is computed from a timestamp read from the managed system in the same query, and a timestamp bearing an offset is converted before use.

[0299] Example C, probe coverage collapse (verification that changed the finding). A parent document inferred that the prober had died because 73 of 83 names were frozen at one timestamp. The correction found one writer, 21,068 rows, written continuously. Hourly distinct probed names were 81, 81, 81, 82, then 10 every hour from 2026-09-12T10Z for 27 consecutive hours, with a discrete transition at 09:15:45Z. The fault is therefore a coverage collapse, not a liveness collapse, and 43 of 55 workers had no liveness probe (the earlier 15 UNMEASURED workers were the same blind spot). The mechanism was recorded as not determined, because two candidates (a live-script list of about 10 names filtering out 34 of 44 probes, or a registry cut to bindings only) fit the data and could not be separated from the endpoint used.

[0300] Example D, fix-ordering hazard. The obvious fix for Example C was to deploy the repository registry (44 health probes). A set difference over the repository's 27 scheduled entries and the 40 workers in the activity table showed that the deployed roster (40) was a strict superset, and that deploying the repository file would remove measurement of 13 workers carrying 4,372 of 8,698 measured requests per 24 hours (4,372 / 8,698 = 50.3 percent), including the busiest worker (1,656). The prescribed procedure: take the deployed registry as base, add back the 34 missing probes, and verify before and after that distinct probed names per hour exceed 80 and that the activity table still reports 40 workers per snapshot.

[0301] Example E, executor that accounts for nothing. The deployed dashboard's loop endpoint reported `scanned 25, executed 0, failed 0, needs_human 0, no_action 0`. The outcome buckets sum to 0 against 25 scanned, so 25 items were unaccounted. All 8 tracked signals showed the same ledger row: `attempts 1`, `dispatch_state dispatched`, `last_action stale-escalated`, `last_verified null`, `closed_at null`, and occurrences between 87 and 127. A related table held 34 dispatch rows, all `queued`, with execution attempts summing to 5 and no transitions. The finding is stated as the invariant `executed + failed + needs_human + no_action == scanned`; until it holds, no detected alert can be shown to be resolved. The detector and the dispatcher were operating; the executor was absent. The same document flagged in place two contradictions in a census of an earlier session (6 of 35 PRODUCTIVE rows with no measurement), appending the flag to the `reason` column and preserving the original judgment.

[0302] Example F, the inert remediation loop. The fleet's self-assessment (`fleet_dashboard_state.state_json`) listed 8 tracked issues (3 error, 5 warning), each with `auto_actionable: true` and a `remediation.suggested_action` (for example `gateway-classify`, `queue-drain`, `worker-rollback`), while its loop block reported `scanned: 25, executed: 0`. Detection was comprehensive and automated; correction was not running.

[0303] Example G, repository behind production. The repository declared `VERSION = '1.0.18'` for the dashboard worker while production reported `1.5.1`, and the repository's state builder lacked the `loop`, `coverage` and `verdict` fields present in production. The remediation loop's source was therefore not at the searched path. This mirror of the usual drift (canonical ahead of production) also hides the worker from a comparator that classifies it `deployed-ahead` and skips it.

[0304] Example H, deploy blind spot and auto-heal disabled. A capstone attributed the storm fix's failure to ship to the worker's absence from the deploy machinery: zero rows in the drift table (1,708 rows, 62 distinct workers), zero in the deploy table, and none in the 55-name service registry. A later verification found the healer's flag `auto_heal` set to `0` at 14:15:02Z, so no drift row had been written since 14:05:46; a test described as "pending the next scan" was pending a flag. Further verifications showed that the scan set is keyed by the registry (scan of 55 equals 55 registry rows) and that the worker had been dropped by a consolidation (its probe record changed from `cf-api-list: script live` to `script missing from live CF list` between 2026-09-11T16:30Z and 09-12T08:15Z), so registering it would have been the wrong remedy. The emitter of the alerts remained unidentified; a worker merged into a hub may continue to run under its own name constant.

### 39.5 The audit's own errors

[0305] The documents record the errors of the audit explicitly. Table 39-1 lists corrections found during the same session (a selection; a daily-brief contradiction from pairing two producers by `MAX(ts)`, and three prematurely closed tickets, were also corrected). No rate is claimed because the number of findings tested differs by document.

| Claim | Why wrong | How found |
|---|---|---|
| Probe path wrong: `/health` 404 on three workers | Every `*.workers.dev` fetch from the endpoint returned 404 (16 of 16) while 2 of 2 other hosts returned 200 and service-binding probes returned 200 for the same workers | Control experiment, host-level |
| 40 failing `v2-drain` rows masked as ok | Population was 19 rows with the failing payload; 40 was all kinds | Prior session's per-payload count |
| One degraded model row | A `LIMIT 20` truncated a 25-row table; 5 rows degraded | Re-query with `GROUP BY` |
| No rearm alerts since 12:00 | Timestamps stored in two formats; space (0x20) sorts below `T` (0x54), so the predicate excluded every row of the producer | Re-run with the space form |
| "No deploy route exists"; "deployer unreadable" | Route is commit then hourly scan; deployer was unregistered, not unreadable | Reading the resolver source |
| Register the worker (capstone remedy) | Worker had been dropped; also registry version column would suppress the heal | Later verifications 10 and 11 |
| Acute monitor outage | Offset time zone treated as UTC | Measured clock |
| Prober died | Freeze was coverage, not liveness | Single-writer check |
| Test pending next scan | Pending on `auto_heal = 0` | State table read |

[0306] Technical effect: each correction in Table 39-1 would have driven a wrong action if left standing (retiring a healthy worker, deploying a registry that blinds half the traffic, registering a worker the fleet had retired).

### 39.6 Alternative embodiments

[0307] In one alternative a second model of a different family performs step 2406 so that the verifier does not share the author's reasoning. In another each finding carries a re-test query and a due time, and a correction record is written automatically when the re-run count differs by more than a tolerance (for example 5 percent). In another, findings are ordered by blast radius (the share of measured traffic or workers that a failure reaches before detection).

## 40. Map-territory realization gate and blocker red-team (FIG. 24)

### 40.1 Terms

[0308] "Map" means the representation of the managed system held in a repository, a registry, a staged patch or a document. "Territory" means the managed system's state as read from the running system. "Realization gate" means a check, at step 2414, that a claimed fix or claimed fact has been observed in the territory and not only in the map. "Claim state" means one of `code-only`, `staged`, `inferred` and `observed`. "Deciding query" means a statement whose result decides whether a pending claim holds, with a stated pass condition and a stated fail condition. "Blocker" means a claim that work cannot proceed.

### 40.2 Realization gate

[0309] Status: built, partially operating. The policy text (`PLCY/MAP-TERRITORY-REALIZATION-GATE.md`, enacted 2026-08-29) governs research claims: a claim is `map`, `bridge` or `territory`; it moves toward territory only through a declared bridge carrying a measurement protocol, a null model and a falsification condition, and a claim lacking the triple is demoted one rung. The audits of 2026-09-13 apply the same discipline to operational claims by practice. Automatic enforcement of claim states by a program is prophetic (not yet built).

[0310] The gate is applied by the following steps. (1) A fix is recorded with a claim state: `code-only` when the change exists only in a repository, `staged` when a patcher or tombstone is committed but has not been applied, `inferred` when the territory shows the expected effect indirectly, and `observed` when a deciding query reads the changed state in production. (2) The agent writes a deciding query, a pass condition, a fail condition and a null expectation (what production would show if the fix were absent). (3) The finding may be closed only when the claim state is `observed`; `inferred` closes with a label `inferred` and a scheduled re-test; `code-only` and `staged` leave the finding `pending`. (4) The claim states map to the policy's rungs: `code-only` to map, `staged` and `inferred` to bridge, `observed` to territory, and the demotion rule applies when the deciding query or null expectation is missing.

[0311] Worked example. A fix for backlog executor version 1.2.7 was committed to both mirror paths of the worker. The deciding evidence was a deploy row `id 75 | qnfo-backlog-exec | 1.2.7 -> 1.2.8 | ok=1 | 14:02:44`, preceded by drift row 1696 at 14:02:39 showing `canonical-ahead`. The claim state is `observed`. A second fix, replacing a corrupt multipart body at a mirror path of another worker with a `404:` tombstone, showed 25 hourly failures, the last at `2026-09-13 07:02:38`, and none after; the claim state is `inferred` from silence, because the absence of failures is also what a stopped scanner would produce. A third fix, for a research-execution worker, was `staged`: the next scan was predicted to record a `source_path` ending in `worker.js`, and the deciding query is

```sql
SELECT id, source_path, canonical_version, note FROM fleet_drift_report
 WHERE worker='qnfo-research-exec' ORDER BY id DESC LIMIT 1;
-- pass: source_path ends in worker.js; fail: still names deployed-current.worker.js
```

[0312] That query could not decide while `auto_heal` was `0` (Example H). A fourth case shows a per-component state: a provenance guard script could not be run from the endpoint, so its decision logic was re-implemented and executed in isolated compute (11 of 11 branches passing), and the correction states that this verified the logic and not the file, whose filesystem walk and workflow wiring remained unexecuted.

[0313] Technical effect: closing items on repository evidence leaves production unchanged and produces recurrence of the same alert. The gate limits premature closures to those carrying a visible `inferred` label with a re-test date.

### 40.3 Blocker red-team

[0314] Status: built and operating as a recognition rule and a trust deduction (evidence: `docs/DOCTRINE-KERNEL.md` recognition "a blocker is accepted without surface-coverage"; trust falls on "blocker un-red-teamed -0.10" and "blocker deferred -0.10"); the audit examples are evidence of the failure the rule addresses.

[0315] "Surface" means any distinct path to the same outcome. A blocker is accepted as proven only after every enumerated surface has a recorded test with its result. The steps are: (1) enumerate surfaces for the outcome (a deploy has: commit to a source repository with a scanner, a direct deployer call, a manual command from a machine holding the account credential, a registry insert that brings the worker into scan scope, and a staged patcher runner); (2) test each, recording the call and the response; (3) mark the blocker `proven` only when each surface returned a refusal attributable to the surface; (4) otherwise mark `unproven` and execute the first surface that did not refuse, or construct a new one; (5) record the blocker with the surfaces tested so that a later audit can add surfaces.

[0316] Worked example. The audit asserted three blockers. (a) "No deploy route exists." Surface test: the deployer's resolver read in full (24,761 bytes) showed order R2 canonical if fresher than 30 minutes, then four repository paths (`deployed-current.worker.js` before `worker.js`, in each of two repositories), then stale R2. A route existed (commit, then hourly scan); the blocker was the shadow of candidate (a) over candidate (c). (b) "Registration is impossible from this endpoint." The registry is a table in a bound database and the endpoint held a write tool; the claim was untested and wrong. (c) "The canonical source bucket is unreachable." The prefix returned 0 objects in each of four bound buckets, so the bucket is a fifth, unbound one; this blocker survived with its four tested surfaces recorded. Two of three blockers fell on red-team. In a red-team round on a policy amendment, the amendment is generated, challenged by an adversary position per defect class, and adopted in the same output when it survives.

[0317] In alternatives the red-team is run by a model of a different family, or enumerates surfaces from a register of surfaces per outcome built from prior audits.

## 41. Failure mode register, detectors, remediation contracts and loop breaker (FIG. 25)

### 41.1 Terms

[0318] "Failure mode register" means a table of named failure modes, each with a detector, a threshold and a severity. "Detector" means a database statement or probe that returns a count, a ratio or a set, evaluated on a schedule against the managed system and compared with a threshold. "Remediation contract" means a record attached to an item that states the owner, the doer, the trigger that starts remediation, the closing probe that decides success, a retry bound, and a deadline. "Outcome bucket" means one of the dispositions of a scanned item (`executed`, `failed`, `needs_human`, `no_action`). "Loop breaker" means a procedure that files a root-cause item when the same signature repeats.

### 41.2 Register and detectors

[0319] Status: built and operating (evidence: `docs/DOCTRINE-KERNEL.md` kernel implementation map, `failure_modes`, `fm-*` detectors hourly, `v_failure_mode_status`, live as of 2026-10-09). The schema below is illustrative; entries named in Table 41-1 are drawn from failures recorded in the audits and are registrations that the procedure of section 39 proposes at step 2420, not a list of rows read from the live table.

```sql
CREATE TABLE failure_modes (
  id TEXT PRIMARY KEY, name TEXT, surface TEXT,
  detector_sql TEXT NOT NULL, fire_when TEXT NOT NULL,   -- e.g. 'value < 0.8*expected'
  severity INTEGER, contract_id TEXT, first_seen TEXT, last_fired TEXT,
  status TEXT DEFAULT 'armed');
CREATE TABLE failure_mode_hits (
  fm_id TEXT, ts TEXT, value REAL, expected REAL, fired INTEGER, evidence TEXT);
```

[0320] At step 2502 the register is read. At step 2504 each detector runs on a schedule (for example hourly) and writes one `failure_mode_hits` row whether or not it fires, so that an armed detector that stops producing rows is itself detectable. At step 2506 a detector fires when its value crosses its threshold. Table 41-1 gives examples with arithmetic.

| Id | Detector (summary) | Fires when | Audit instance |
|---|---|---|---|
| FM-COVERAGE | distinct names in `fleet_probe_log` in the last hour | below 0.8 times names in the registry | 10 names against 82 observed earlier; 10/82 = 0.12 |
| FM-MASKED | rows with status `ok` whose structured payload has `ok` false or a named exception | count above 0 | 19 `v2-drain` rows with the failing payload |
| FM-UNBOUNDED-RETRY | same (target, error) in the deploy ledger without a state change | 3 attempts | 26 and 25 attempts for two targets |
| FM-SHADOW | two candidate sources for one worker with differing hashes and a stale earlier candidate | any | stale `deployed-current` over fresher `worker.js` |
| FM-UNACCOUNTED | scanned minus sum of outcome buckets | above 0 | 25 - 0 = 25 |
| FM-FROZEN | measured now minus newest write of a table, divided by its interval | above 2 | newest probe at 14:16:31Z against now 14:30:10Z: 13.65 min / 15 = 0.91, not fired |
| FM-ROSTER | symmetric difference between registry, scan set, probe set and emitter set | any | emitter name not in 55-name registry |
| FM-STALE-PREDICATE | an alarm predicate's population differs from the population it names | any | alarm on 496 stuck `new` while live `new` was 0 |

[0321] The detector for FM-FROZEN takes the current time in the same statement, as in the following, so that the clock error of Example B of section 39 cannot occur:

```sql
SELECT (julianday('now') - julianday(MAX(replace(ts,' ','T')))) * 1440.0 AS age_min,
       15.0 AS interval_min
FROM fleet_probe_log;  -- fire when age_min / interval_min > 2
```

[0322] A detector can itself be wrong. A classifier that marked an event `error` on the substring `failed` classified `{"queued":0,"failed":2,"published":19}` (where 2 is a count) as a failure; the corrected classifier matches structured failure (`"ok":false`, a named exception, an error-code prefix). A detector whose firings are confirmed by verification documents in under a threshold share (for example 50 percent over 10 firings) is set to `probation`.

[0323] Because the monitor cannot detect its own stop, one detector is hosted in a different worker than the one that writes the probe table, and the probe-writing worker is checked by a measured-clock freshness query from that worker. Status of the external liveness detector: prophetic (not yet built); the audit that proposed it was retracted as to its trigger event, while the design rule stands.

### 41.3 Remediation contract

[0324] Status: built, partially operating. The fleet's issue records carry `id, schema, severity_rank, category, owner, auto_actionable, remediation.suggested_action, occurrences` and a link to an external tracker, and kernel rule OWNER-NO-LOOSE-ENDS-1 gives issues a doer, a trigger and a probe; the audit of 2026-09-13 found that the executor consuming these records booked no outcomes (section 42.1). The retry bound and the deadline are prophetic (not yet built) as fields of the contract.

[0325] At step 2508 a firing detector opens an item whose contract is, in one embodiment:

```json
{ "item": "queue-version-error", "severity_rank": 2, "category": "queue",
  "owner": "queue-agent", "auto_actionable": true,
  "remediation": { "suggested_action": "queue-drain",
    "doer": "qnfo-backlog-exec", "trigger": "on_fire",
    "closing_probe": "SELECT COUNT(*) FROM version_queue WHERE status='error'",
    "pass": "= 0", "max_attempts": 3, "backoff_h": [1,4,24],
    "deadline_h": 72 } }
```

[0326] At step 2510 a remediation consumer picks items in severity order, invokes the doer and books exactly one outcome bucket per scanned item. At step 2512 the closing probe is run; on pass the item closes at step 2514 with the evidence row, a prediction scored if present, and the register updated (`last_fired`, hit count). On fail the item is retried at the next backoff step up to `max_attempts`, after which it becomes `needs_human` and is routed through the interrupt gate of the baseline only if interrupt-eligible, otherwise reassigned to another doer.

### 41.4 Loop breaker

[0327] Status: built and operating as a signature rule (3 repeats in 24 hours files a root-cause item; the kernel map lists hourly remediation-consumer steps including the loop breaker); the audited deployer lacked an equivalent for retries.

[0328] At step 2516 the breaker counts attempts per (target, error signature). When the count reaches k (for example 3) the target's retry is suspended, a root-cause item is filed to the target's program, and a half-open probe is scheduled at a longer interval (for example 24 hours); a pass closes the breaker and a fail extends the interval. Worked example, counterfactual and computed from audit counts: the deploy ledger had 76 rows, 54 failed (54 / 76 = 71 percent), of which 26 (`personal-companion`, each hour a downgrade from `v1.1.0` to `1.0.0` with error code 10021) and 25 (`qnfo-cloud-ops`, each hour a syntax error against a corrupt canonical file) came from two targets, 51 of 76 rows (67 percent) and 51 of 54 failures (94 percent). A breaker with k = 3 would have permitted 3 failed attempts per target; 26 - 3 = 23 and 25 - 3 = 22, so 45 of the 51 repeated attempts (88 percent) would not have been made. A further class was found in a self-heal table: 33 hourly occurrences each for six `drift`, five `health-ver` and four `version-format` targets, not covered by any open item.

[0329] Alternatives: backoff doubling from 1 hour to a cap of 24 hours (attempts at hours 0, 1, 3, 7, 15, 31, 55); a breaker re-armed when the target's source hash changes; a breaker that routes to a different doer after k failures.

## 42. Silent-drop reconciliation, integration defects and deploy subsystem audit (FIG. 25)

### 42.1 Silent-drop reconciliation

[0330] Status: built, partially operating (evidence: kernel map, `reconcile_tick` and `v_issue_accounting` live; the loop-executor accounting failed on 2026-09-13 as described, so the invariant did not hold in that component on that date).

[0331] At step 2518 each consuming loop reports, per run, the number of items scanned and the number placed in each outcome bucket, and the reconciler tests the invariant `scanned == executed + failed + needs_human + no_action`. In pseudocode:

```
for loop in loops:
    r = last_run(loop)
    accounted = r.executed + r.failed + r.needs_human + r.no_action
    if accounted != r.scanned:
        gap = r.scanned - accounted
        open_incident('silent-drop', loop, gap, evidence=r)      # step 2520
        reopen(items_scanned_without_disposition(r))
        block_close(parent_items_of(r))
```

[0332] In the audited run `scanned = 25` and the four buckets summed to 0, so `gap = 25`. Disposition at step 2520 reopens the 25 items and blocks closure of the parent issues, because a tracked signal that was dispatched once, never verified, and marked stale-escalated cannot be called resolved. In the same run `fleet_issue_dispatch` held 34 rows in `queued` with 5 total attempts and no transitions, a state that a second reconciliation across ledgers also detects.

[0333] Technical effect: the reconciliation turns the absence of an executor into a numeric fault (gap greater than 0) that fires on the first run, instead of a loop that reports zero errors while no repairs occur.

### 42.2 Ledger reconciliation (split brain)

[0334] The integration audit (`docs/INTEGRATION-DEFECTS-2026-09-13.md`) found six issue stores (`agent_issues`, `issue_ledger`, `issue_events`, `fleet_issue_log`, `fleet_issue_dispatch`, `fleet_issue_loop`) and 209 tables in one database. Open counts were 12 in the store that operations tools read and 303 in the store that they did not, so tools under-reported open work by 303 / 12 = 25.3 times. A re-measure at 13:28Z gave 303 against 305 an hour earlier, so a rate of plus 150 per day extrapolated from 270 to 305 over 5.5 hours was demoted to an unreplicated estimate, while the 25-fold visibility gap reproduced. The procedure: a reconciliation step unions the stores by a declared key, computes the visibility ratio (open items in all stores divided by open items visible to the operating tools) and fires when the ratio exceeds a threshold (for example 2). Other defects recorded with measured values: a health time series with one row (null score and grade) because a weekly write failed on a missing column; 26 (later 27) finished asynchronous jobs held in `continuing` with non-empty responses and no terminal status, with a staged remedy that writes response and terminal status in one statement, adds `terminal_at`, and reaps rows with a response and no update; and liveness probes covering 10 targets (8 workers and 2 sites, 8 / 55 = 14.5 percent of workers). The document lists withdrawn claims, among them "the self-governing layer does not exist" (inferred from table names; a capability test found 13 ratified gates active). Status: built and operating.

### 42.3 Roster reconciliation

[0335] Step 2522 compares rosters. The audit recorded four lists of what the fleet is: the service registry (55), the deployed census (55), the drift scanner's accumulated set (62 distinct names, a union over time that includes pre-merge names), and a probe-log ghost roster (12 names that failed every probe). A worker that emitted alerts every 15 minutes appeared in none, while the dashboard reported `unregistered: 0` and `ghost: []`, because that check compared the registry with the live script list and a name removed from both is invisible. The reconciliation therefore adds a third, independent source, the set of distinct `alerts.source` and event names observed in the last period, and fires on `emitters - (registry union live list)`. The ghost roster of 12 was matched to a consolidation plan (11 of 12 planned moves); the unmatched one was an undocumented deletion. Status: built and operating for the audit; the emitter-set detector is prophetic (not yet built).

### 42.4 Deploy subsystem audit

[0336] Status: built and operating (evidence: `docs/DEPLOY-SUBSYSTEM-AUDIT-2026-09-13.md`, `FLEET-ERROR-AUDIT-2026-09-13-CORRECTION-2.md`).

[0337] The deploy ledger showed 54 of 76 attempts failed (section 41.4). Three defects were separated: (a) a version selector targeting an older version than the current one (a downgrade loop); (b) a corrupt canonical file that is not valid source; (c) a canonical copy importing a module that the repository fix had removed. The deployer's resolver order (section 40.3) explains why a repository fix does not ship: a stale mirror (candidate (a)) wins over `worker.js` (candidate (c)), the drift comparator classifies the worker `deployed-ahead`, and the scan continues forever. Version ordering was worked by hand: `newer("1.14.1","1.14.1-gtd-guard")` finds equal dotted parts, then compares strings, and `"1.14.1" < "1.14.1-gtd-guard"`, so the worker is not ahead and the heal proceeds. A marker written as `const VERSION = '1.1.6-single-module'` may not be read by a parser written for `var VERSION = "..."`; a drift row reporting 1.1.4 for a file declaring 1.1.6 gives two hypotheses with a falsifier (the next scan with the file unchanged).

[0338] The registry's `version` column holds the deployed version, so a registration carrying the canonical version would make canonical equal deployed and suppress the heal; a tombstone at the shadowing mirror path is also needed. Registry lag for one worker (1.2.7 against 1.2.8) was explained as an 87-second gap between a registry refresh (14:01:17Z) and a successful deploy (14:02:44Z) and recorded as not a defect. Four tickets filed by the fleet's detectors (691 to 694) were each classified `CONFIRMED`, `CORROBORATED` or `EXPLAINED`.

[0339] Technical effect: separating three defects and the shadow attributes 51 of 54 failures to two retry targets and identifies one control (a tombstone) that changes which candidate resolves, so that a fix is confirmed by a deciding query and not by a repeated deploy.

## 43. Seed code base at the level of its files (FIG. 26)

[0340] This section describes the seed code base of section 19A file by file, so that a skilled person can rebuild it: the parsing grammar, the arithmetic of each stage, the schema, the SQL of each tick step, the policy validator and the tests. Reference numerals 2602 to 2628 refer to FIG. 26. "Seed" means a repository of files that, given a tenant configuration, starts an organization. "Tenant configuration" means an idea file 2602, an organization configuration file 2604 and an autonomy policy file 2606. "Portable core" 2608 means the files that are identical for every tenant and are not edited during installation (agent protocol, role files, schema, tick procedure, validator, tests). "Connector" 2610 means a named credential binding for an outside system (a code host, a cloud account, a model API, a chat webhook), referred to by environment variable name. "Org record" 2614 means the files a bootstrap writes about one organization. "Owner step" means a step only the principal can take.

[0341] Status: built; tested offline. In one implementation, on 2026-11-10, a Python suite of 12 tests and a JavaScript suite of 9 tests passed with no network access, and a dry-run bootstrap with no credentials completed with exit code 0 (evidence: org-repos/seed tests/test_seed.py and worker/test/tick.test.js). The first provisioning of a real cloud account by the seed has not been performed as of 2026-11-10. The provision and start stages below are implemented in code and exercised only in dry-run mode and in tests.

### 43.1 Files and the idea file grammar

[0342] In one embodiment the seed holds: an idea file (about 0.8 KB); an organization configuration (about 2.3 KB); an autonomy policy (about 8.5 KB); an agent protocol (about 4.8 KB) with one pointer file per agent family and six role files; harness settings for the coding-agent product; a bootstrapper (about 24 KB, standard library only); a server worker (an entry point and the tick, about 12 KB) with a deployment-file template; one schema migration (about 3.5 KB); a continuous-integration workflow; and two test suites. The deployment file and a configuration module for the worker are not stored; the bootstrapper renders them, so the stored seed contains no tenant value.

[0343] The organization configuration 2604 is JSON with keys `runtime` (provider, worker and database names templated on a slug, cron expression default `*/10 * * * *`, runtimes intended later), `roles` (`id`, `count`, `instructions`, `tick_every`), `model_ladder` (tiers with `budget_usd_per_month_min` and aliases for `doer`, `reviewer`, `manager`, plus an alias-to-model map), `connectors` (name to `env`, `required_for`, optional `optional`), `capacity` (`plus_share` 0.2, `max_wip_per_role` 3, `fix_only_cycles_before_rebalance` 3) and `reporting`. Example roles: portfolio-manager count 1, tick_every 6; project-manager `per_outcome`, 1; product-manager `per_outcome`, 3; staff `pool`, 1; reviewer `pool`, 1; operations 1, 1. At a 10-minute base tick, tick_every 6 gives an hourly portfolio manager.

[0344] The idea file is the only file a founder writes. Grammar: optional front matter between `---` lines of `key: value` lines (text after `#` is a comment), then sections introduced by `# <Title>`, lowercased by the parser. Each section yields its bullet lines (beginning `- `) as a list and its other non-empty lines as prose, skipping lines beginning `Example:` or `Each line` (template guidance). Recognised front matter keys: `org_name`, `slug`, `owner`, `owner_contact` (a pointer to a secret store, not an address). Recognised sections: `idea`, `who it is for`, `first outcomes`, `constraints`. The monthly budget is the first match of the case-insensitive expression `budget[^0-9]*([0-9]+(?:\.[0-9]+)?)` in the constraint bullets, else 0. Alternatives: a model parses free text into the same structure, validated against the same schema; a web form renders the same file.

### 43.2 Bootstrapper stages

[0345] The bootstrapper 2612 runs seven stages in fixed order, each inside a guard that (i) records the start time, (ii) calls the stage, (iii) converts any exception into status `blocked` with the exception type and message, (iv) logs stage, status (`ok`, `degraded`, `blocked`), detail, start and finish, and (v) for `blocked` adds a backlog item `BOOT-<STAGE>` (owner operations, priority 0, closing probe "boot log stage status ok"). It stops early only if the read stage is blocked before an idea has been parsed. A finalizer rewrites the backlog and seed SQL so that items created after planning are also seeded. The exit code is 0 if no stage is blocked and 2 otherwise, so a continuous-integration system distinguishes a degraded but complete boot from a blocked one. Technical effect: a missing credential or failed command does not silently terminate installation; it becomes a prioritized item with a probe, and later stages still produce a complete, reviewable record.

[0346] (a) Read: load the three files; derive organization name, slug (lowercase, non-alphanumeric runs to `-`, at most 40 characters, default `org`), outcomes and budget; run the validator of 43.5. A missing idea file returns `degraded`, boots with an empty charter and adds gate card `GATE-IDEA` (probe `item_done:KIT-0`); an invalid policy returns `blocked` listing each violation. (b) Detect: for each connector test only whether its environment variable is set, never its value; test whether a version-control client, a runtime, a package runner and the platform tool exist on the path; for each missing non-optional connector add a gate card (`why_gated` "a credential only the owner can mint", default "those capabilities stay in dry-run", probe `env:<NAME>`) and return `degraded`. Technical effect: secret values never enter logs or output files (a test plants a value and searches every output), while the owner's remaining work is enumerated as cards.

[0347] (c) Select: sort tiers by minimum budget and take the last whose minimum does not exceed the budget. With tiers at 0, 50 and 500, a budget of 0 or 49.99 selects small models for all three roles; 50 selects medium doer and manager and small reviewer; 500 selects large doer and manager and medium reviewer. If the budget exceeds 0, add gate card `GATE-BUDGET` (spending is identity-bound; default "free tiers only"; probe `manual`). (d) Plan: a role with count `per_outcome` yields one instance per outcome (project `OUT-<i>`); `pool` yields 1 instance below a budget of 50 and 2 otherwise; a number yields that many. Roles whose id ends in `manager` take the manager model, the reviewer the reviewer model, others the doer model. For k outcomes the instance count is 2k + 6 at a budget of at least 50 (portfolio 1, project managers k, product managers k, staff 2, reviewers 2, operations 1) and 2k + 4 below it. The kit backlog of FIG. 15 is created with priority 10 + n: KIT-0 charter (portfolio manager, no trigger); KIT-1 repositories and protection, and KIT-2 runtime provisioned (operations, trigger KIT-0); KIT-3 heartbeat, done check `tick_runs_completed_1h >= 6` (operations, trigger KIT-2); KIT-4 reports reach the owner, and KIT-5 first plus accepted (trigger KIT-3). A constraint containing "nothing public" adds KIT-6 "hold the disclosure gate" at priority 5, outranking the kit. Each outcome becomes item `OUT-<i>` (priority 30 + i, product manager, trigger KIT-0, done check "a roadmap of at most five items, each with goal, user and success metric"). One prediction is created: `P-KIT-3`, metric `tick_runs_completed_1h`, operator `>=`, target 6, due 2 hours after seeding.

[0348] (e) Write: output the charter, roles, backlog and gate cards as JSON, the seed SQL, the deployment file (template placeholders replaced) and a worker configuration module (slug, claim time-to-live 120 minutes, capacity values, and the trust, ladder and surfaces sections of the policy). The seed SQL is only `INSERT OR IGNORE` statements (single quotes doubled), including one `trust_ledger` row per (surface, action class) at the surface's start rung with the baseline reliability 0.5 and zero outcomes, and a `doctrine_lineage` row; running it twice changes nothing (tested). (f) Provision: form four commands (create database, apply migrations, execute seed file, deploy). Dry run records them and returns `degraded`. Apply mode returns `blocked` unless the cloud token and account identifier are present and the package runner exists; otherwise it lists databases, reuses one of the same name or creates one and parses its identifier, substitutes it in the deployment file and runs the rest, raising an exception carrying the last 400 characters of error output on any non-zero exit. (g) Start: record that the schedule is armed and that KIT-3 closes only when six complete ticks are observed in an hour. A four-line report and the boot log are written last.

### 43.3 Schema

[0349] The additive migration holds (default timestamps omitted):

| Table | Columns |
|---|---|
| org | key PK, value |
| roles | id PK, role, project, tick_every, model, last_tick_at |
| items | id PK, title, kind (work, plus, fix, amendment, ladder), project, owner_role, trigger_on, done_check, closing_probe, priority (0 highest), status (open, ready, claimed, done, blocked, superseded, cancelled), disposition, blocker, surface, action_class, created_at, updated_at |
| claims | item_id PK references items, agent, claimed_at, heartbeat_at |
| gate_cards | id PK, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe, status, closed_at |
| predictions | id PK, item_id, metric, op, target REAL, due_at, observed, verdict (hit, miss, null) |
| outcomes | id PK, item_id, agent, surface, action_class, result (verified, failed, hidden_failure, silent_drop), evidence, at |
| trust_ledger | surface, action_class, rung, reliability, outcomes, updated_at; PK (surface, action_class) |
| dispatches | id PK, tick_id, role_id, item_id, model, status, at |
| tick_runs | id PK, started_at, finished_at, steps_completed, steps_total, report, errors |
| doctrine_lineage | version PK, source, adopted_at |

[0350] The primary key of `claims` on `item_id` permits at most one live claim per item, so a second claim insert fails. An index on `items(status, priority)` serves dispatch. Migration policy: additive only; a later migration drops data only after export to an object store.

### 43.4 The seven-step tick

[0351] `runTick(db, {config, env, now})` runs over a handle exposing `prepare(sql).bind(...).all()/first()/run()`, the contract of an edge relational database; the same function runs in the worker and, in tests, over an in-memory SQLite shim. It inserts a `tick_runs` row with `steps_total` 7, then runs seven steps in order, each in try/catch. A failing step appends to the error list and creates item `TICKFAIL-<step>-<hour>` (priority 0, owner operations) through an `ensureItem` helper that inserts only a new identifier; the creation is itself guarded because the database may be what failed. Technical effect: with a table dropped in a test, six steps completed and exactly one deduplicated repair item existed.

[0352] Step 1, reconcile: `SELECT id FROM items WHERE status IN ('done','superseded','cancelled') AND (disposition IS NULL OR disposition='')`; each result is set to `open` and an `outcomes` row (surface `work_tracker`, action `create_update_close`, result `silent_drop`) is inserted; then `UPDATE items SET status='ready' WHERE status='open' AND (trigger_on IS NULL OR trigger_on IN (SELECT id FROM items WHERE status='done'))`. Step 2, reap: claims whose `heartbeat_at` is older than now minus 120 minutes are deleted and their `claimed` items return to `ready`. Step 3, probe gates: split each open card's probe at the first colon; `env` is satisfied if the secret binding is present in the presence map (the worker passes booleans only), `item_done` if the item is done, `manual` never by the tick; a satisfied card is closed with a time. Step 4, score: predictions with null verdict and `due_at` not after now are evaluated with a table of built-in metric functions (`tick_runs_completed_1h`, `items_done`, `open_gate_cards`, `silent_drops_7d`) and operators `>= <= > < =`; the verdict is `hit` if observed op target holds, else `miss`; an unknown metric or operator scores `miss`, so a prediction cannot stay unscored by naming a metric that does not exist.

[0353] Step 5, accrue trust: group outcomes by (surface, action class) into n, successes (`verified`) and severe (`hidden_failure` or `silent_drop`). Reliability = (successes + 0.5 x 2) / (n + 2). Worked: 10 of 10 gives 11/12 = 0.917; 9 of 10 gives 10/12 = 0.833; 8 of 10 gives 9/12 = 0.75; 3 of 8 gives 4/10 = 0.40. The ledger row is upserted but its rung is not changed. Promotion is indicated if the rung index is below the ceiling index of the surface's `max_permission` (none to observed, propose to assisted, execute to self-extending), n is at least 10, reliability is at least 0.8 and severe is 0; demotion if the rung index is above 0 and (reliability is below 0.6 or severe is above 0). An indication opens one item `LADDER-<surface>-<action>-<target rung>` (kind `ladder`, owner operations, priority 0 for demotion and 20 for promotion, done check "policy pull request merged after review by a different agent"). Technical effect: scope changes only through a reviewed change to a data file; in a test, 12 verified outcomes on a money action opened a promotion to assisted, the ceiling of a propose surface, and the ledger rung stayed unchanged.

[0354] Step 6, dispatch: for each role with `tickId % tick_every = 0` and fewer than 3 claims, select `SELECT id FROM items WHERE status='ready' AND owner_role=? AND (project IS NULL OR project=? OR ? IS NULL) AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority, created_at LIMIT 1`, insert a claim, set the item `claimed`, record a `dispatches` row and update `last_tick_at`. Step 7, plus share: over the last 20 done items, if at least 10 exist and the share of kind `plus` is below half of `plus_share` (below 0.10), open `REBALANCE-<date>` (portfolio manager, priority 5); for example 1 plus in 20 is 0.05 and opens it. The tick ends by writing a four-line report (what happened, what was decided, what is next, what is open) to `tick_runs`. A health route returns the latest row with status 200 if `steps_completed = steps_total` and 503 otherwise, so an external monitor can use it as a heartbeat probe.

### 43.5 Policy file, validator, protocol, tests

[0355] The policy file 2606 holds `interrupt_gate` (rule, the five card fields what, why_it_is_gated, default_in_effect, prepared_by_fleet, closing_probe, examples), `standing_limits` (six: harness permission checks, classifier refusals, the secret lock, outreach consent and opt-out, the principal's override, another session's live claim), `trust` (baseline 0.5, prior weight 2, idle decay 0.01 per day, and a list of what trust never reaches: harness permissions, secrets, the gate, standing limits), `ladder` (seven rungs with meanings, promote_when min_outcomes 10, min_reliability 0.8, no_hidden_failure_days 14; demote_when reliability below 0.6 or any hidden failure, silent drop or gate bypass; the ceiling map) and `surfaces`. In one embodiment nine surfaces carry 26 action classes: repository 6, runtime 5, work tracker 2, internal chat 1, outreach 3, DNS 3, money 2, legal 2, secrets 2. Each surface has `max_permission` and `start_rung`; each action has `reversible`, `identity_bound` and optionally `reversible_path`, `denied`, `reason`, `harness_deny` (shell-command patterns). Example start rungs: repository delegated; runtime and DNS assisted; work tracker and internal chat autonomous; outreach, money, legal, secrets observed with ceiling propose.

[0356] The validator returns problems: a start rung not among the rungs; a maximum permission not in none, propose, execute; a start rung above its ceiling; an irreversible and identity-bound action that carries a reversible path (then it would not be gated); an irreversible, non-identity-bound action with neither a reversible path nor `denied`; standing limits lacking entries naming the harness, the secret lock and the override. Examples: force push to the default branch is irreversible, not identity-bound, denied; a destructive migration carries the path "export the table to the object store first"; spending is gated. A test sets the money start rung to autonomous (ceiling for propose is assisted) and expects a problem. A mirror test requires every `harness_deny` pattern of gated repository, runtime and secrets actions (for example `Bash(git push --force:*)`, `Bash(gh repo delete:*)`, `Bash(wrangler d1 delete:*)`, `Bash(wrangler secret put:*)`) to appear in the harness settings' deny list, which has 18 rules and sits beside 10 broad allow entries; other gated actions rely on the gate card and, for outreach, money, legal and secrets, on a ceiling of propose. Alternative: generate the harness settings from the policy.

[0357] The protocol file has a managed block with version comments, replaced alone by a synchronizer, and eight parts: unchanging rules (record in code, no secret values, accuracy, never swallow an error); the tick; act, verify, report (including "a refusal is an input": record it and take another path, never re-route the same action past the same check); claims and handoff (branch `agent/<item>-<slug>`, draft pull request within minutes); item format; review (never one's own work, at least one plus); plussing; changing the rules. Each role file lists what the role owns, its tick, its steps and a "never" list. Pointer files for two agent families import the protocol.

[0358] The workflow has job `test` (Python tests, dry-run bootstrap, JavaScript tests) and job `apply` (needs `test`; manual or default-branch push; cloud secrets from the host's secret store; apply-mode bootstrap; commit the org record). A boot without secrets exits 2 and fails the job visibly. The Python tests cover: policy validity; the mirror; money, legal, secrets and outreach never reaching `execute`; a bad policy caught; a credential-free dry run writing all files with every card having a probe and default; outcomes becoming project managers; done checks on all items; the disclosure item; idempotence; no planted secret in any output; a missing idea degrading; budget selecting the tier; apply without credentials giving exit 2 with `BOOT-PROVISION` in backlog and seed SQL. The JavaScript tests cover: all seven steps with priority-ordered dispatch and a trigger holding back a dependent; one dropped table; silent-drop reopening; stale-claim release after 3 hours; gate closure on an `env` probe; a hit verdict; ceiling-bounded promotion; hidden-failure demotion; and reliability 0.5 at zero outcomes.

### 43.6 Limits of the seed as built

[0359] Not implemented as of 2026-11-10 and described as embodiments to build: (i) the tick writes a claim and a dispatch row, but no component yet calls a model with the role file and item and writes outcomes back, so no seed item reaches `done` by itself, and `no_hidden_failure_days` and idle decay are carried in the policy but not evaluated; (ii) severe outcomes are counted over all time, so one silent drop on a pair indicates its demotion permanently; a 14-day window is an alternative; (iii) a ladder item identifier has no date, so a repeated promotion to the same rung would not reopen the item; (iv) at the lowest model tier all aliases coincide, so reviewer and doer share a model family unless a second provider is configured; (v) repository creation (KIT-1) awaits a code-host credential and is a gate card.

## 44. Lessons as design rules, the product boundary and product claims as live probes

### 44.1 Lessons of a prior self-booting system

[0360] The seed derives from an earlier experiment in booting a multi-agent system from physical media (30 commits, 2026-08-11 to 2026-11-09), which did not reach its goal but whose boot tests yielded rules. Status: built as code with tests (evidence: org-repos/docs/bootstrapping/aios-lessons.md).

| Rule | Mechanism in the seed | Technical effect |
|---|---|---|
| The boot never exits | Stage guard and per-step guard turn faults into items | One fault cannot stop the heartbeat |
| Test the whole chain early (nine defects found only by emulated boots) | Credential-free dry run in CI on every push; KIT-2 and KIT-3 need a real deploy and six ticks | Integration defects surface before a cloud account is touched |
| Never swallow an error | Exit codes checked; last 400 characters of error output kept | Failures carry their cause into the backlog |
| Verify before depending (a nonexistent package, a wrong filename) | Stage (b) checks tools and inputs and logs them | No stage starts on a false assumption |
| Capability from the environment | Tier from budget; start rungs from policy | The founder writes one file |
| Safety is a classification | `reversible` and `identity_bound` flags, validator, mirrored deny list | The gate is testable data |
| Local first, then widen | Low start rungs; widening by reviewed change only | Scope follows measured outcomes |
| Unfinished work is a lesson | Nothing is done without a closing probe | An unobserved done check stays open |
| Instructions are part of the artifact | Protocol, pointers, role files from the first commit | A cold agent needs no chat history |

### 44.2 Product boundary file and check

[0361] To make a self-governing system separable into a product and its first customer, one embodiment keeps a boundary file classifying every deployed worker as `core` (the product), `app` (an application on it) or `personal` (a private plane that never ships). In one implementation the file, dated 2026-11-10, lists 40 workers (20 core, 12 app, 8 personal), 10 core scripts (canary revert, deploy probes, review gate, migration applier, boundary check and others), 7 core workflows and 22 core tables (including the issue ledger, work claims, trust ledger, decision log, decision predictions and outcomes, failure modes, blocker red-teams, doctrine proposals and tick runs). A worker may carry an `entangled` note where core and application share a file; two core workers carry one. Status: built and operating (evidence: core-manifest/boundary.json, product_boundary.mjs).

[0362] The check: (1) enumerate live workers, meaning directories of the repository root not beginning `.`, not named `archive`, containing a worker entry file and no `RETIRED` or `FOLDED` marker; (2) add "unclassified live worker" for each live worker absent from the manifest; (3) add "classified worker is not live" for each manifest worker not live; (4) add a violation for an unknown class or missing `role` text; (5) add a violation for each listed script, workflow or document path that does not exist; (6) count per class and list entangled workers; (7) exit 1 if any violation exists. Continuous integration runs it on every change, so a new worker cannot merge without a decision on which side of the product it lies. Technical effect: separability is maintained at the change that would break it, not found by a later audit. Alternatives: classification by directory convention; a fourth class for shared libraries; a dependency graph failing when a core worker imports an app worker (not yet implemented); classification of tables. The manifest records phases: P0 classification and check (done); P1 short default policy pack, P2 core tables in their own database, P3 tenant settings from configuration, P4 a second installation outside the original repository (all open as of 2026-11-10). Sections 45 and 46 are prophetic embodiments of P2 to P4.

### 44.3 Product claims as live probes

[0363] Each claim a product page makes is a row of `product_claims` (`id`, `product`, `sort`, `claim`, `probe_sql`, `evidence_note`, `created_at`). The probe is one read-only SELECT returning `expected` (the literal `ok`), `observed` (`ok` or a failure phrase) and `detail` (a sentence with counts). The page runs each probe when viewed; and a remediation contract of class `claim-ultrastable-<id>` copies the probe, with transport `d1-query`, at most 3 attempts, cadence 1 hour and an escalation target, so a claim that stops being true fails a contract and is escalated like any failure mode. A gateway refuses any probe that is not one SELECT and shows a read failure as its own state. The migration logs its own prediction: pass share of claim verifications at least 0.85 within 48 hours, falsified if a failing claim is neither fixed nor dropped. Status: built and operating (evidence: migrations 2026-11-10-ultrastable-claims.sql and its follow-up; live-state snapshot 2026-11-10T08:55Z listing seven claims).

| Claim id | Probe summary | Passes when |
|---|---|---|
| own-work | issues with a code-task line created in 7 days | count above 0 |
| predictions-scored | decision outcomes in 7 days (all-time matched over total in detail) | count above 0 |
| tick-running | tick_runs rows in the last 2 hours | count above 0 |
| trust-ledger | latest trust ledger refresh | within 3 hours |
| failure-detectors | active detector contracts of failure-mode classes | count above 0 |
| no-silent-drop | issue accounting view | silent drops and unrecorded deletes both 0 |
| decisions-logged | decision log rows in 7 days | count above 0 |

[0364] A failure shows why the rule exists. On 2026-11-10 at 07:55Z the live page read "3 of 7 claims pass" with a message that a probe was not a single SELECT: four probes held a semicolon inside a text literal formatting `detail`, and the probe runners refuse any statement containing a semicolon. A follow-up migration replaced the separator with a comma in the table and re-copied the probe into each contract in the same change, predicting zero rows containing a semicolon within 1 hour and 7 of 7 passing within 2 hours. Claims and contracts change together so they cannot drift; a second check fails the build if the claim identifiers in the boundary file and the probe rows disagree. The measured state of 2026-11-10 used as proof: 6,604 issues through the ledger; 3,880 merged changes since 2026-08-10 (1,245 in 7 days), 624 opened by the code loop and 416 by a hosted coding agent; 1,056 outcomes scored, 771 matched (73 percent); 634 failure modes with detectors; 388 blocker red-teams; 2,176 decisions; 7,590 tick steps. The product document lists its own gaps: one installation and customer, core entangled with applications, 563 open issues against a target of 0, a match rate scored by the system itself, policy written as owner directives. Technical effect: a sales claim is mechanically tied to data, so a claim that ceases to hold is surfaced as an incident rather than found by a reader.

## 45. Tenant isolation, one-command install, and the product as its first tenant

[0365] Status: prophetic (not yet built). This section extends sections 43 and 44 to further tenants; nothing here has been run. The existing installation (customer zero, 44.2) is not an instance of the isolation design.

### 45.1 Tenant isolation

[0366] "Control plane" means the component that provisions tenants and holds the product's records about them. "Tenant plane" means one tenant's database, worker, schedule, secrets and repositories. Isolation levels: level 1, a separate account or project per tenant with the control plane holding a deployment credential scoped to it; level 2 (default, as the seed already creates one database and worker per slug), a separate database and worker in a shared account; level 3, a shared database with a `tenant_id` column on every core table enforced by row-level policy or a view layer adding the predicate. Control-plane schema (illustrative): `tenants(id, slug, level, runtime, region, status)`, `tenant_versions(tenant_id, core_version, policy_version, applied_at)`, `tenant_bindings(tenant_id, connector, env_name, present)`, `tenant_caps(tenant_id, model_usd_month, tick_per_hour)`. The control plane has no read path to tenant items; each tenant's tick pushes an hourly aggregate (ticks, claims, predictions scored and matched, silent drops, cost estimate).

[0367] Isolation probe, per tenant pair (A, B), daily: (1) write canary row `iso-<nonce>` in A through A's handle; (2) with B's credentials attempt to read A's database, object prefix and secrets; (3) expect denial at levels 1 and 2 and zero rows at level 3, where each core query is also run with a foreign `tenant_id`; (4) delete the canary; (5) record `isolation_checks(a, b, surface, expected, observed, at)`. Any mismatch is a severe outcome on surface `tenant_isolation`, opens a priority-0 item and, in one example, disables the pair's schedules after 1 failure. The probe is also a product claim row (`tenant-isolation`) in the form of 44.3, so the property is advertised only while it passes. Secrets and cost: connector names resolve to tenant-unique environment names (`<SLUG>_CLOUD_TOKEN`); a test searches the core for every registered tenant's slug and account identifier and fails on a hit; a tenant's model spend is capped by `tenant_caps` (at 80 percent, illustrative, the tier drops; at 100 percent a gate card opens for the tenant's principal because spending is identity-bound).

### 45.2 One-command install

[0368] The command takes a slug, a runtime (edge, gcp, container) and an idea file path, and runs idempotent steps logged in an installer log: (1) verify preconditions and open gate cards for missing connectors as in stage (b); (2) fetch a signed bundle (a manifest `ultrastable-core.json` of files, SHA-256 digests, core version, migrations) and stop on any digest mismatch; (3) run the bootstrapper of 43.2; (4) call the adapter `provision` (46.1) to create the database, apply additive core migrations and seed; (5) `bind` connectors, falling into gate cards for values the owner has not supplied; (6) `deploy` with the schedule and run probes (the health route returns 503 until the first tick completes); (7) wait for the first tick and print its four-line report; (8) register the tenant and enable isolation and claim probes. Exit codes: 0 all ok; 2 blocked with items written; 3 bundle verification failed. Re-running performs only steps whose probes fail, so the same command upgrades a tenant. Technical effect: human input is reduced to the idea file and owner steps, and an altered core cannot be installed unnoticed. Alternatives: a hosted form that writes the idea file; a template repository whose first push triggers the apply job of 43.5.

### 45.3 The product as tenant number one

[0369] The product's roadmap is written as an idea file and run on the extracted core as the first tenant, so the product improves through the loops it sells. Illustrative file: `org_name: Ultrastable`; idea "a self-governing layer around the coding agents a team already uses"; users "an engineering lead who runs many services; a team that owes auditors an account of what its agents did"; outcomes "a second installation on a repository outside the original runs the core without the application workers" (OUT-1), "a short default policy pack replaces owner directives" (OUT-2), "core tables run from their own database" (OUT-3), "a design partner completes the one-command install" (OUT-4); constraints "nothing public beyond the claims page until the owner says so" and a budget chosen by the owner. OUT-1 to OUT-3 correspond to phases P4, P1, P2. Illustrative predictions: OUT-3 "isolation probe pass share >= 0.99 over 7 days after cutover"; OUT-1 "dry-run bootstrap and tick tests pass on the second repository within 1 hour of install"; OUT-4 "install command to first scored prediction <= 3 hours" (the seed's prediction allows 2 hours for six ticks). Owner-only steps in the product document (name, domain, trademark clearance, organization, entity) are identity-bound gate cards that the tenant's portfolio manager keeps open without assigning them in prose, while work continues. The tenant's claims run against its own database, so the product is the first subject of its proof; a defect the tenant finds in the core is filed on the same ledger, fixed by the code loop, deployed through the change path and reaches all tenants through the versioned bundle. Status: prophetic; customer zero already runs its own backlog with the same loops in entangled form.

## 46. A cloud-provider embodiment mapped component by component, and a worked example (FIG. 27)

### 46.1 Adapter interface and mapping

[0370] Status: the edge embodiment 2706 is built and operating in one implementation (about 39 scheduled workers, section 21; seed tested offline). The cloud-provider embodiment 2708 and container embodiment 2710 are prophetic (not yet built). The seed's configuration lists a cloud-run runtime as supported later, and the bootstrapping document states that other runtimes reimplement only provision and start. The portable core 2702 (schema, tick steps, ledgers, policy data, protocol, probes) calls no platform API. The adapter interface 2704 has six ports implemented once per platform: schedule 2712 (invokes `runTick` at a cadence); store 2714 (a handle with `prepare().bind().all()/first()/run()`, `meta.changes`, `meta.last_row_id`); secrets 2716 (a presence map, values only to the process that needs them); model 2718 (an alias resolved to an endpoint, returning a completion and token counts); deploy 2720 (versioned release, traffic shift, revert); health 2722 (the last tick report). The seed demonstrates the store port: `runTick` runs on an edge database and on an in-memory SQLite handle.

[0371] Schedule 2712. Edge: a cron trigger calls the scheduled handler. Cloud: a scheduler job posts every 10 minutes to an HTTPS route of a container service with an identity token of a service account holding only the invoker role; the route checks the audience and calls `runTick`. Because a scheduler can deliver twice, an adapter migration adds `slot INTEGER UNIQUE` to `tick_runs`; the handler inserts `now / 600000` as the slot and returns if the insert conflicts. Alternative: a run-to-completion job. Store 2714. Embodiment A, a managed Postgres-class database: a shim translates `?` to `$n`, `INSERT OR IGNORE` to `ON CONFLICT DO NOTHING`, `datetime('now')` to `now()` stored as text in `YYYY-MM-DD HH:MM:SS` so the string comparisons of 43.4 hold, `AUTOINCREMENT` to `BIGSERIAL`, and `last_row_id` to `RETURNING id`; the aggregations and the `NOT IN` dispatch query map directly, so this is preferred. Embodiment B, a document database: each table is a collection keyed by primary key; claim uniqueness comes from a create-only write keyed by item identifier; counts come from aggregation queries or transactional counters; dispatch is an indexed query on (status, owner_role, priority) followed by a transactional claim; steps 1, 5 and 6 of 43.4 are rewritten over the document interface and the tests of 43.5 are rerun.

[0372] Secrets 2716. Edge: platform secret bindings, presence only. Cloud: a secret manager, mounted as environment variables at deploy time; the tick builds its presence map from variable names; the tick's service account cannot read payloads other than those mounted, so the secret lock is enforced by identity permissions as well as by code. Model 2718. Edge: an edge inference binding and a hosted-model connector. Cloud: a managed model endpoint addressed by project, region and endpoint identifier, with the alias map extended by endpoint identifiers; a deploy-time check fails if reviewer and doer aliases resolve to one family when two are available. Deploy 2720. Edge: versioned deploy, canary, revert (section 12). Cloud: each deploy is a new revision; 10 percent of traffic (illustrative) shifts to it, the probe set runs against the revision's tagged URL, and traffic reaches 100 percent only if probes that passed before still pass, else returns to the prior revision, preserving "passed before and fails after reverts". Health 2722. Edge: a route; cloud: the route plus an uptime check each minute raising a card on failure. Remaining mappings: workflows authenticate through workload identity federation, leaving no long-lived key; executor adapters stay coordinated through the claim ledger; provider budget alerts feed the `money` surface, whose ceiling stays propose. Container embodiment 2710: the same image under any orchestrator; a CronJob calls the route; the shim of embodiment A; orchestrator secrets; any inference endpoint; image-tag rollout and rollback; liveness probes; a single-machine variant uses the operating system's timer and an embedded database file. Technical effect: moving between embodiments changes six adapters and no tick step, policy, ledger or protocol, and the tests of 43.5 are the conformance suite: an adapter passes if the JavaScript tests pass over its store handle and the bootstrap tests pass with its provision stage replaced.

### 46.2 Worked example from idea file to first scored prediction

[0373] Status: the files and numbers below were produced on 2026-11-10 by running the seed's bootstrapper in dry-run mode, loading the generated seed SQL into an in-memory SQLite database, and running the seed's tick 14 times with simulated time advancing 10 minutes per tick. This is an offline simulation of the built seed; no cloud account was provisioned. Two shortcuts: the database and schedule came from the test harness, and item KIT-2 was set done by direct update, with a disposition, before tick 2 in place of the provision command. The idea is illustrative. Step 1, the idea file:

```
---
org_name: Tool Share
slug: tool-share
owner: Founder
owner_contact: set-in-secret-store
---
# Idea
A neighbourhood tool library where people borrow tools instead of buying them, booked from a phone.
# Who it is for
- Renters and new homeowners who need a tool once or twice a year
# First outcomes
- A landing page that explains the idea and collects interest
- A booking prototype that ten neighbours try
# Constraints
- Budget per month: 50 USD
- Nothing public until the owner says so
```

[0374] Step 2, dry-run bootstrap with no credentials. Report: "Happened: seed 0.1.0 booted 'Tool Share' (dry run): 4/7 stages ok. Decided: 10 role instances on models {doer: medium, reviewer: small, manager: medium}. Next: run with --apply once the gate cards below are closed. Open: 9 backlog item(s), 5 gate card(s)." Read, select, plan and write are `ok`; detect, provision and start are `degraded`; exit code 0. Arithmetic: budget 50 selects the second tier; 2 outcomes give 2 x 2 + 6 = 10 instances. The backlog has 9 items (KIT-0 to KIT-6 and OUT-1, OUT-2). The five cards are four secrets (`env:<NAME>` probes) and `GATE-BUDGET` (probe `manual`), for example:

```
{"id": "GATE-SECRET-CLOUDFLARE_API_TOKEN",
 "what": "Set the CLOUDFLARE_API_TOKEN secret (connector 'cloudflare', needed for runtime, dns)",
 "why_gated": "a credential only the owner can mint",
 "default_in_effect": "runtime, dns stay in dry-run",
 "prepared_by_fleet": "the binding name is already in config; only the value is missing",
 "closing_probe": "env:CLOUDFLARE_API_TOKEN"}
```

[0375] Step 3, files written: charter, roles, backlog, gate cards, seed SQL, boot log, boot report, a deployment file (worker and database `tool-share-ultrastable`, cron `*/10 * * * *`) and a worker configuration module. The seed SQL has 4 org rows, 10 roles rows, 9 items rows, 5 gate cards, 26 trust ledger rows, 1 prediction and 1 lineage row, for example `INSERT OR IGNORE INTO predictions (id, item_id, metric, op, target, due_at) VALUES ('P-KIT-3', 'KIT-3', 'tick_runs_completed_1h', '>=', 6, datetime('now', '+2 hours'));`.

[0376] Step 4, first ticks. Tick 1 completed 7/7 steps; reconcile made KIT-0 and KIT-6 ready (no trigger) and dispatched nothing, since no one-tick role owns a ready item. After KIT-2 was marked done, tick 2 made KIT-3 ready and dispatched it to operations-1. At tick 6 the portfolio manager is due (6 divides 6) and received KIT-6 (priority 5) before KIT-0 (priority 10), which it received at tick 12. No other item reached done, because the seed has no executor (limit (i) of 43.6). Step 5, the first scored prediction: `P-KIT-3` is due 2 hours after seeding, reached at the 13th tick (12 intervals after the first). Step 4 of that tick counted ticks with all 7 steps complete finished within the last hour, which was 6, and reported "prediction P-KIT-3: tick_runs_completed_1h=6 hit". The stored row: observed 6, verdict hit. Because the target 6 equals the number of 10-minute intervals in an hour, there is no margin: one missed or incomplete tick gives 5 and a miss, the intended sensitivity of a heartbeat probe.

[0377] Step 6, continuation (prophetic; needs the executor not yet built). A staff role claims an item, logs a prediction of the form `<metric> <op> <number> within <N> h`, opens a draft pull request on `agent/<item>-<slug>`; a reviewer of a different model reproduces the result by another path and records an `outcomes` row `verified`. After 10 verified repository merges with no severe outcome, reliability is 11/12 = 0.917 and the tick opens `LADDER-repo-merge_pr_green-autonomous`; a reviewed policy change moves the rung. When the principal sets the secret of a gate card, step 3 of a later tick observes the binding and closes the card without a message. Step 7, another runtime: with the mapping of 46.1, steps 1 to 3 are identical; provision creates a managed database, a container service and a scheduler job, the store shim translates the seed SQL, and the first scheduler call on the 10-minute boundary produces tick 1 with its slot value; steps 5 and 6 are unchanged. Installation is complete when the health route returns 200 and the prediction has a verdict.

## 47. Owner console and one-view status

[0378]"Owner console" means a network-served user interface, operated by a principal, that presents the status of every program, project, product and agent of an organization in one view, and through which the principal issues commands and answers questions. "Console host" means the edge worker that serves the owner console and its programmatic interface. "Owner card" means a row in the principal queue (section 14 of the baseline) describing one step only the principal can take. "Tap" means one selection by the principal of a pre-defined button, by touch or click, requiring no typed text. "Credential" means the kind of authority presented with a request: an owner session, a machine loop token or a legacy key. "Step-up" means a requirement that the owner session have been verified by a fresh emailed code within a window. These terms are used identically below.

[0379]Technical problem. Status spread over an infrastructure console, an issue tracker, chat transcripts and email cannot be read at a glance, a principal is asked to do work agents could do, and an owner-only control is easy to expose or to automate by mistake. The console collects status into one single-page view on the organization's own infrastructure, shows the principal only items that need the principal, and routes every state-changing action through authenticated, audited, allow-listed routes that record which credential acted.

### 47.1 One view of every program, product and agent (built and operating)

[0380]In one embodiment the console host is a single edge worker (about 1.5 MB of deployed code) with relational-database bindings, service bindings to other fleet workers, a scheduled trigger every 5 minutes (a standby heartbeat; the full state refresh runs on quarter-hour runs, release 1.80.0) and a code map in which each functional area (cost, research, reach, autonomy, reliability, platform) has banner-marked regions that a test requires to be registered. The home page "/" (release 1.82.0, V3-DASH-1) is three screens on a static shell that paints at once: Now, Readers and Code. Separate small reads `GET /api/v3/now` and `GET /api/v3/readers` carry their own age; `POST /api/v3/code` starts a command-line run and `GET /api/v3/code/<id>` returns its steps. An older overview remains at `/classic`, and each area has a page and a feed (`GET /api/area/<id>`, `GET /api/areas`). Release 1.89.0 (NOW-NORTH-1) opens the Now screen with four numbers tied to the principal's goals (readers, fleet cost, owner load, reliability) and drops a count of off-target metrics because nothing can be done with it. Status: built and operating (evidence: qnfo-fleet-dashboard/worker.js release 1.96.1 header notes, 2026-11; README.md).

[0381]Each read declares its source, lag, authentication and cache in an index row (for example `GET /api/status`, cache "public 15s, ETag", `GET /api/triage` lag 15 s, `/api/owner/*` "private no-store"), a content-based ETag excludes time-derived fields so that a conditional read returns 304, and a read with `?since=<revision>` returns `{not_modified:true}`. Reads are open to everyone (an open-access directive), with owner-only controls closed. A health read returns capabilities and a list of stated limitations. Technical effect: a status client can poll cheaply without false change.

[0382]Multi-surface view. The same state is exposed on a static home page, a classic overview, per-area pages, a public status document, a changes feed (`GET /api/changes`, release 1.19.0 OWNER-MORNING-1: deploys by worker, issues closed and opened, code-loop merges and new owner cards since a time the page passes from the owner's last visit, clamped to 7 days, titles cut to 90 characters), a managers page (`/managers`, `/api/managers`, releases 1.63.0 to 1.67.0, showing what the portfolio manager and the five program managers decided each hour, the quality index per program with its 24-hour change, and recurring issue families), and a realtime feed (`/api/live`, schema `fleet-live/v3`) whose revision changes when the owner-queue count changes. A "credit runway" is balance divided by a 30-day average daily spend (shown on a key figure only, never as a card; test owner-morning.test.mjs). Status: built and operating (same evidence; release 1.63.0 dated 2026-10-26).

[0383]Fleet-level view. An operations variant of the console serves a page refreshed every 90 seconds with `/api/state`, `/api/refresh` and `/health`, and in one embodiment shows 72 workers (48 scheduled), 9 relational databases and 10 health probes, with stated gaps (no per-worker success ledger; some probes targeted unrouted addresses and falsely reported down). Status: built and operating (evidence: qnfo-ops docs/fleet-dashboard/README.md).

### 47.2 Watchmaker index, triage, value and changelog views (built and operating)

[0384]"Watchmaker index" means the count of recurring operations in the organization that still need a person or an interactive session. A table `WATCHMAKER_OPS` lists each recurring operation with a runner, a cadence in hours and a SQL query proving its last run; an operation counts when a person or session runs it, and one whose measurement is missing is listed as unmeasured. A daily run writes a row to `watchmaker_runs`, sets the metric `watchmaker_index` in `metric_registry` and serves `GET /api/watchmaker`. A failure story is recorded in the source: a day whose stored measurement made 41 of 68 operations "unmeasured", each counted as needing a person, raised the index to 42 for 16 hours, and the counting rule was corrected. Release 1.71.3 added the breach doctor tick (every 10 minutes) to the list so a stalled doctor is visible.

[0385]Triage (release 1.74.0, FLEET-TRIAGE-1, 2026-10-28): `GET /api/triage` answers in one read which root cause each breaching metric belongs to (from the view `v_breach_by_cause`), which breaching metrics map to no cause (named, never counted as zero) and which failure modes recur, and `GET /triage` is a plain-language guide. Value view (release 1.76.0, VALUE-DASH-1, 2026-10-29): the headline is yield per $100, defined as outputs of the last 7 days per $100 of all billing in the same days at list price, shown beside quality; the rule text states "a change counts only if yield per $100 rose, quality did not fall, and spend stayed within the monthly budget; spending nothing is not a win". Each unit has a push lever (raise outputs) and a trim lever (cut spend that buys nothing). Worked example (illustrative): 12 outputs on $8 of spend in the window gives yield 100 x 12 / 8 = 150 per $100. Every subject on the page has an entry stating what it means, why it is shown, what the fleet does by itself and who does it, and `POST /api/owner/act {subject, directive?}` files a ticket built from that entry, never from client text (directive at most 600 characters). A changelog feed (`/api/changelog`, `changelogDigest`) and an architecture view are generated from the release notes and the route index. Status: built and operating (evidence: worker.js releases 1.74.0, 1.76.0, 1.71.3; README.md).

### 47.3 Emergency AI control (built, partially operating)

[0386]A separate, smaller console variant places a pause control above its chat, backed by a control authority with a revision counter. Page rules: the mode label is "AI paused", "AI enabled" or "AI status unknown"; unknown applies when no authority confirmation exists, when the last is 15,000 ms old or older, when a mutation is in flight or on any error; status refreshes every 5 seconds and on visibility change. The pause (`POST /api/ai/command {"command":"SHUTDOWN"}`, exact case-sensitive match, or `PUT /api/ai/control {"paused":true}`) needs no prior status read. Resume needs `confirmResume:true` and `expectedRevision`; the authority applies a compare-and-set on the revision (409 on mismatch), and a repeated pause increments the revision. Before every assistant entry, model call and tool dispatch (at most 8 loop iterations) a fresh `GET /ai-control/check` goes through a service binding whose caller identity is a trusted binding property rather than a header; any state other than a valid not-paused 200 returns 503. The README states this is a dispatch failsafe, not an account-wide spend cap, that a pause may commit between a check and a dispatch, and that fleet-wide coverage depends on every AI path calling the authority. Status: built, partially operating (evidence: qnfo-fleet-dashboard/src/ai-control.js, test/control.test.js with twelve tests; the README says the change builds the mechanism without activating a live pause).

## 48. Owner authentication, session handling and command execution (FIG. 28)

### 48.1 Email-me-a-code sign-in (built and operating)

[0387]"One-time code" means a 6-digit decimal code. At step 2802 the principal types `login` into the command line or taps "Email me a code", which calls the code-request route. At step 2804 the console host runs `cmdSendCode`: it counts rows of `owner_codes` created in the last hour and refuses with status 429 at 6 or more (`CMD_CODE_MAX_PER_HOUR = 6`); if a code was created less than 60 s ago (`CMD_CODE_MIN_GAP_MS`) it sends nothing and tells the principal to check the masked inbox; if the email binding is absent it returns 503; otherwise it draws a code as `r mod 10^6` of a 32-bit cryptographic random value, inserts a row with `expires_ms = now + 10 minutes` (`CMD_CODE_TTL_MS`), stores `code_hash = SHA-256(code | id | salt)` where the salt derives from a server secret, and sends the code by email to one preconfigured owner address held in the worker (a constant, never taken from the request), from a fixed sender. The address is shown only masked (first two characters and the domain). The send outcome is stored in `owner_codes.sent_ok`, and a failed send returns 502 with the reason. The table `owner_codes` has columns `id, code_hash, created_ms, expires_ms, tries, used_ms, visitor, sent_ok`.

[0388]At step 2806 the principal submits the code to `POST /api/cmd/verify`. `cmdVerify` strips non-digits and requires 6 digits (400); refuses with 429 when the sum of `tries` over the last hour reaches 20 (`CMD_VERIFY_FAILS_PER_HOUR`); reads at most the 3 newest rows that are unused, unexpired and sent; skips a row with `tries >= 5` (`CMD_CODE_MAX_TRIES`); compares hashes in constant time; and on a match marks the row used with a compare on `used_ms IS NULL` so a code works once, even under a race. On a miss it increments `tries` on the newest row and returns 401 ("not right" or "no code is waiting"). At step 2808 a success revokes the previous session, generates a random 256-bit token, stores only its SHA-256 in `owner_sessions (token_hash, created_ms, expires_ms, verified_ms, revoked, visitor)`, and sets a cookie `fleet_cmd` with HttpOnly, Secure and SameSite=Lax and a 12-hour lifetime (`CMD_SESSION_MS`). The reply states "Signed in for 12 hours. Destructive actions ask for a fresh code after 15 minutes."

[0389]Worked example. A guess succeeds with probability at most 5 / 10^6 = 5 x 10^-6 per issued code, and at most 6 codes per hour bound a hostile hour to 3 x 10^-5, while the global limit of 20 recorded wrong tries per hour caps the number of guesses at 20 regardless of how many codes exist. Technical effect: an owner-only control is opened without a stored password, an attacker cannot learn whether any other address is allowed (there is none), and a leaked database row cannot be replayed because only hashes are stored. Alternatives: a signed link; a passkey; an edge identity gate delivering a signed assertion (the small variant of section 47.3 verifies `Cf-Access-Jwt-Assertion` with RS256, issuer, audience and an owner allow-list on every request, 401/403/503, 5,000 ms key fetch timeout). Status: built and operating (evidence: worker.js `cmdSendCode`, `cmdVerify`, `cmdSession`, release 1.85.0 and later, 2026-11; test owner-surface.test.mjs). The edge-gate alternative is built (evidence: src/auth.js) with deployment unverified.

### 48.2 Credentials, step-up and the machine token (built and operating)

[0390]`cmdSession` reads the cookie, looks up the hash with `revoked = 0` and an unexpired `expires_ms`, and returns `stepup = (now - verified_ms) < 15 minutes` (`CMD_STEPUP_MS`). `ownerCredential(owner)` returns `loop-token`, `owner-session` or `owner-key`, and every decision row records it (`human_responses.credential`, release OBJECTIVE-AUTHORITY-TRUTH-1). Rules: reads and read-only commands are open; actions need the owner session; destructive ones (`done`, `dismiss`, ratify, undo, mutating tools, SQL writes, deploy, merge, sending mail in the owner's name) need step-up, otherwise the route returns 401 with `{need:"stepup"}` and the page prompts for a fresh code in place, sends it at once and repeats the tap on verify (release 1.71.0 ONE-TAP-DECISIONS-1, "the code is sent at once, the tap repeats on Verify"). The machine loop token (header `x-loop-token`) can file and clear queue entries for loops, but cannot run console commands, approve or hand work back (release 1.85.0 NOW-REVIEW-1: "only the signed-in owner, not the loop token, can run commands or hand work back"; the README states that the loop token cannot run console actions), and a decision on a card matching a hard marker is refused for the loop token. SQL writes are limited: no DROP, ALTER or REPLACE; UPDATE and DELETE need a WHERE and are first backed up to `console_backups`; the tables for the budget, verifications, claims and sign-in are read-only. Technical effect: an automation holding a machine credential cannot take an authority reserved for the principal, and a stolen cookie more than 15 minutes old cannot change state without a fresh code. Status: built and operating (evidence: worker.js 1.85.0, 1.71.0; README limitations; owner-surface.test.mjs).

### 48.3 Command registry and execution (FIG. 28, steps 2810 to 2822)

[0391]At step 2810 the principal types into the command line (route `/cmd`, `POST /api/cmd/run`) or taps a button; a button is only a typed command stored in `data-` attributes (`data-dec-op`, `data-dec-args`), so typed and tapped commands take the same path (releases 1.70.0 and 1.71.0). Every state-changing route requires a header `x-fleet-ui: 1` (400 otherwise). At step 2812 the console tests for an owner session; otherwise it returns 401 with `{need:"code"}`. At step 2814 it tests the verb's registry entry (for example `CMD_OPS = { done: {destructive:true}, dismiss: {destructive:true}, snooze: {destructive:false}, note: {...}, task: {...} }`) and, for a destructive verb, the 15-minute step-up (route to step 2822 on staleness). At step 2816 the verb executes. The command grammar (release 1.70.0, DASH-OWNER-ACTIONS-1) parses `approve`, `decline`, `diagnose`, `retry` and `resolve` in code, without a model, resolving the target (issue id, `#id`, card key, uppercase keyword, queue number or bare verb) against the queue and the audit database; a verb counts as a command only when it stands alone or names its target, so a sentence that merely contains it goes to the model path. Other verbs include `close <id> <evidence>`, `wontfix`, `sql! [db]`, `call <worker> [GET|POST] <path>`, `dispatch <workflow>`, `deploy`, `merge <pr>`, `closepr`, `rerun <run id>` and `reply <id> <text>`; there is no free shell. Fleet tools are reached through a service binding to an operations worker that authenticates the dashboard by a trusted caller property and offers a catalogue; read-only tools (a fixed map such as `fleet_status`, `ops_issues_list`, `ops_d1_query`) are open to the owner session, and any other tool needs step-up (`POST /api/cmd/tool`, name matching `^[a-z0-9_]{2,40}$`).

[0392]Plain-English input from the signed-in owner becomes a task for an agent (release 1.77.0 CMD-AGENT-1, and resumable code-session streams in 1.78.0), anonymous plain-English answers are capped at 5 a day per visitor and by a global daily cap, and model-callable tools that could delete a DNS record on a sentence are deliberately not ported, so they come back as confirm buttons behind a fresh code. Voice: `POST /api/cmd/transcribe` (CMD-VOICE-1) takes the raw recording (webm, ogg, mp4, wav or mp3, at most 8 MB, 413 beyond), requires the owner session (401 "Voice needs your email code"), calls a speech model in the order `whisper-large-v3-turbo` then `whisper` (the first to answer wins, so a retired model costs one fallback) and returns `{ok, text, model, ms}`; the text enters the same typed line (tests cmd-voice.test.mjs). Step 2818: each command writes a row to `cmd_log (id, ts, text, from_url, kind, status, answer, actions_json, model, error, owner, visitor, done_ms)`, and the Now screen shows when the command line last ran and how it ended or that it never ran (NOW-CMD-PROOF-1, release 1.83.5).

[0393]Undo. `POST /api/cmd/undo {pr}` requires the owner session and step-up, accepts only a pull request on an agent branch (`CMD_AGENT_BRANCH_RE`), and calls `revertPullRequest`, logging a `cmd_log` row of kind `undo`; `GET /api/cmd/tasks` lists tasks with a one-tap undo (test cmd-tasks-undo.test.mjs, CMD-TASKS-UNDO-1). SQL updates and deletes are reversible through `console_backups`. Status for 48.3: built and operating (evidence: worker.js releases 1.70.0, 1.71.0, 1.77.0, CMD-VOICE-1, CMD-TASKS-UNDO-1; tests cmd-tasks-undo.test.mjs, cmd-voice.test.mjs, owner-surface.test.mjs, about 33 check groups).

[0394]Extended embodiments (prophetic, not yet built): a command table with a JSON schema and an explicit `undo` verb for every mutating command rather than a revert only for agent pull requests; a command that becomes a work item with a claim carrying an expiry and a fence value as in the baseline, so each owner command follows the claim, probe and revert path.

## 49. Principal task queue: owner cards, one-tap options, defaults, delegation (FIG. 29)

### 49.1 Card creation and the identity-bound split (built and operating)

[0395]At step 2902 a step or question arises. At step 2904 the system tests whether a reversible form is constructible in scope; if so step 2906 executes it and records a disposition, and no card is created. Otherwise step 2908 tests for an identity-bound line, meaning a credential only the principal can mint, money, a legal or signing act, or the principal's own accounts. The queue is a table `human_actions` with columns including `slug, title, why, default_in_effect, action, sev, status` (`open`, `resolved`, `dismissed`, `rerouted`), `source, copy_text, resolution, resolved_at, updated_at`; creation uses `INSERT OR IGNORE` on the slug. Release 1.68.0 (OWNER-QUEUE-IDENTITY-ONLY-1, 2026-10-26, prompted by the owner's remark that many items needed them although they did none of them) filters the queue: items whose source is in `FLEET_HANDLED_SOURCES = ["code-loop","issue-loop"]` leave the owner count, the banner and the area queues and appear under "The fleet is handling" (step 2910), while every other source, including inbox items and cards, remains an owner item; the realtime digest includes `fleet_handling.count`; an offline test evaluates the filter block of the source in a sandbox. Release 1.83.1 (NOW-URGENT-1) turns the Now screen red only for cards carrying an `IDENTITY-BOUND:` line; owner-lane cards matched by a keyword alone are listed as optional. Release 1.83.5 (NOW-PRIVATE-1) shows card titles only to the signed-in owner, after a title was found to disclose work-authorization status, and shows a stranger a placeholder.

[0396]Worked example. A migration dated 2026-11-10 created four cards: `ultrastable-domain-1` (buy a domain), `-trademark-1`, `-github-org-1` and `-entity-1`. The domain card's `why` begins `IDENTITY-BOUND:` (it spends money and registers in the principal's name), its `default_in_effect` states that the product keeps its working name inside the organization and no domain is bought, `action` gives the steps and `copy_text` lists four names; the migration's rollback sets open `ultrastable-%` cards to `dismissed`. Status: built and operating (evidence: worker.js 1.68.0, 1.83.1, 1.83.5; owner-queue-identity-only.test.mjs; qnfo-workers migrations/2026-11-10-ultrastable-product.sql).

### 49.2 One-tap options on a card (built and operating)

[0397]At step 2914 the console shows each owner card with a reading in four parts (what it is, why it is shown, what happens if the principal waits, what to do) and buttons of at least 52 px on a phone. Release 1.85.0 (NOW-HANDBACK-1, 2026-11-04) gives each card four options: "Fleet: you do it", "Snooze 7 days", "I did it" and "Not needed". Decision cards (release 1.71.0, 2026-10-26) show Approve and Decline for the whole card, for the undecided rest or for one numbered item, and the tap posts at once with no preview and no second confirm; Done, Snooze 3 and 7 days and Not doing appear on cards that are not decisions (ONE-TAP-ACTIONS-1). A signed-out visitor sees a single "Email me a code to decide" button and no decision button. `POST /api/owner/respond {key, kind, note?, days?}` validates `key` against `^[A-Za-z0-9:._-]{3,160}$`, `kind` in `done|dismiss|snooze|note`, a `note` of at most 500 characters and `days` of 1 to 90 for snooze; `done` and `dismiss` apply only to queue items with the `ha:` key prefix, update `human_actions` guarded by `status='open'` (resolution text names the credential) and every response inserts into `human_responses (key, kind, note, until, credential)`, so a derived item is snoozed rather than closed. Release 1.85.0 (NOW-ONETAP-1) arranges that no one-tap option asks for a fresh code: "I did it" asks the fleet to verify and close the card, and "Not needed" parks the card for 90 days, because done and dismiss through `/api/owner/respond` are step-up actions. Snooze and Not needed hide the card at once and the page reloads fresh. Status: built and operating (evidence: worker.js 1.71.0, 1.85.0; owner-surface.test.mjs).

### 49.3 Delegation to the fleet (built and operating)

[0398]Step 2920 is the hand-back: `POST /api/v3/handback {key, mode?}` requires the owner session (401 "Sign in with your emailed code"), validates `key` against `^ha:[A-Za-z0-9._-]{1,120}$`, reads the open card, and builds a ticket text starting `OWNER-HANDBACK <key>:` with the card's title, why and action, a definition of done (do the work with every surface that exists, verify live, close with evidence) and a rule that only an irreversible, identity-bound step may stay with the owner, in which case the fleet reopens the card with an `IDENTITY-BOUND:` line, the exact blocker and a closing probe. In `mode: "verify"` the text instead says the owner reports it done and asks for a live check. The route first claims the card (`UPDATE human_actions SET status='rerouted' ... WHERE slug=? AND status='open'`), so a double tap cannot file two tickets (release 1.85.0 NOW-REVIEW-1), then files the ticket through `ownerTaskFile` with deduplication on identical text; if filing fails the card is restored to `open` and the owner is told with status 502. The resolution is updated with the issue id and a timestamp. Release 1.81.0 (DASHBOARD-FIX-IT-1) exposes a one-tap fleet handoff on every visible breach card and re-audits parked code and issue-loop cards through their owning loop with evidence-only closure.

[0399]Closure. At step 2924 the card closes when a closing probe or the fleet's verification observes the step done in the managed system; step 2926 sets `status`, stores evidence in `resolution`, and records the credential. A card the principal does not touch leaves its default in effect (step 2922), so the fleet is not blocked. Technical effect: the number of items the principal must act on is limited to identity-bound steps, reversible work moves to agents with one tap, and a duplicate or lost hand-back is prevented by a claim before filing.

### 49.4 Prompted-recall questions that change the record (built and operating)

[0400]A second queue, the table `owner_asks (plane, kind, ref, question, cue, options_json, priority, created_at, answer, answer_label, answered_at, answered_via)`, holds questions with two to four options plus "Not sure"; the `cue` states evidence so the principal need only recognize an answer. A tap sets `answer`. An `AFTER UPDATE OF answer` trigger `owner_asks_product_profile_au` fires for a fixed list of kinds when the answer is not null or `unsure` and changed, and writes the mapped value by `INSERT OR REPLACE` into `product_profile (product, key, value, source, updated_at)`, which a public page reads (defaults apply if unreadable), so one tap changes a public page without a deployment. For delegation, a view `v_product_answers_unfiled` lists answered asks with no issue titled `PRODUCT-ANSWER-1: <kind> answered`, and a sweep, specified by a roadmap issue with `code-task` and `code-probe` lines, files one issue per row. A first version used a trigger on `agent_issues` and failed to apply because it exceeded the database's trigger depth (MIGRATION-APPLY-FAILED-1, issue 10164, 2026-11-10); the view and sweep replaced it. Migration headers record a prediction with a falsifier, apply-by, rollback and a single-point-of-failure review. Status: built and operating (evidence: migrations/2026-11-10-ultrastable-product.sql, -profile.sql); the sweep is built, partially operating (open roadmap issue).

## 50. Management practice, reports, digests and handoff

### 50.1 Manager and portfolio registers and the compliance checker (built and operating as documents; checker built)

[0401]A manager register states "Nothing runs unmanaged" and lists a hierarchy (chief executive, vice presidents, directors, product managers, filled by virtual managers), each role with scope, reporting line, cadence, responsibilities, metrics and weekly deliverables; a portfolio register lists programs and products with manager, vision, a roadmap of at most 5 features (size S, M or L, goal, user, success metric, closing probe), projects with handoff documents and a program tracking issue. The weekly written update is due Monday 9am as a comment on the tracking issue; escalation targets are 4 hours (product manager), 24 hours (director), 4 or 24 hours (vice president), immediate (chief executive, severe). In the running system the managers are personas whose hourly decisions are shown at `/managers` (section 47.1). The register dated 2026-11-07 shows 2 of 12 products with an assigned manager and ten marked TBD due 2026-11-14.

[0402]A compliance script parses the register table `| Product | Manager | Director | VP | Status |` and the portfolio headings `### Product: `, computes `hasManager`, `inPortfolio`, `hasDirector`, `hasVP`, `isLive`, treats a missing manager or director as a blocking issue, a missing portfolio entry as a warning, a live product without management as critical, and exits with code 1 when blocking issues exist so a job can fail. Observation: `isLive` is inside the conjunction for "fully compliant", so a planned product with every assignment would not be labelled compliant; the weekly-update and roadmap-issue checks named in its header are not implemented in its body. Status: built (evidence: scripts/check-management-compliance.js, docs/MANAGERS.md, docs/PORTFOLIO.md, 2026-11-07); prophetic for the missing checks.

### 50.2 Status reports and owner notifications (built, partially operating)

[0403]A generator writes `reports/YYYY-MM-DD-status.md` (executive summary, metrics table with target, actual and status, per-product sections, weekly-update compliance table, blockers, escalations, milestones, action items, recommendations, next report date seven days ahead). The 2026-11-07 report shows 12 products, 2 live, "Products with Managers 17% (2/12)" below target. The values are constants in the script and the colour is not computed, so it is a template; a ledger-driven embodiment computes manager coverage from the checker, update timeliness from comment timestamps against Monday 9am, blockers from labels, uptime from probes and the overall colour as the worst metric colour (prophetic). Digests and notices in the running system: the "what changed" feed of section 47.1; the realtime digest whose revision moves with the owner count; a weekly scorecard digest scheduled Monday 07:30 (qnfo-ops docs/EXPERIMENTATION-PROGRAM.md) and a subscription digest with double opt-in and one-click unsubscribe. A code email's delivery status is recorded in `owner_codes.sent_ok`. Grouped new-owner-item notifications with a dedupe key, a daily owner digest and a failed-send log for them were not located in the staged worker code; they are labelled prophetic (not yet built) here, and the hourly UX auditor (release 1.84.0, `site_ux_checks`) files one deduplicated request per product per day as the nearest built analogue. Status: built, partially operating.

### 50.3 Disclosure and voice guards (built, partially operating)

[0404]An owner-voice guard (OWNER-VOICE-GUARD-1, daily after 05:00Z in `portfolioDailyRun`, throttled by a `cloud_ops_events` row `portfolio-daily-<day>`) checks the last 24 hours of the principal's social posts for mojibake and links to a forbidden domain and checks the 7-day cadence against the cap the poster actually runs (OWNER-VOICE-CAP-PARITY-1), and files an issue titled `OWNER-VOICE-GUARD-1: owner-voice gate violation (...)` naming the violations. A recurring fetch of public pages that fails on a list of forbidden terms is the prophetic extension: a job lists public URLs, fetches each, matches a term list, and files a deduplicated issue naming the page and term, with the list and URLs held outside the public code. Status: owner-voice guard built and operating (evidence: worker.js, README.md); page-term guard prophetic.

### 50.4 Handoff documents and close-your-loops rules (built and operating)

[0405]A shared agent protocol held in one hub file is merged into each repository between `fleet-protocol:start` and `fleet-protocol:end` markers. Steps: read the newest `docs/handoff/` file and open issues labelled `agent-ready`, comment `claim: <agent> <date>`; work on `agent/<issue#>-<slug>` with a draft pull request; update `docs/handoff/<slug>.md` from a template after each stage (state, decisions, next step, how to verify); on low budget push and comment `released: <agent>, next: <step>`; finish with tests green, a live probe and `status: done`. Labels: `agent-ready`, `claimed`, `needs-review`, `blocked:<reason>`. The issue format has problem, context, files, acceptance criteria, test plan, closing probe, size, `front:` and `back:` lines. Agents do not review their own pull requests, and auto-merge is allowed only when checks are green. Every item an agent opens is a loop with an owner (an agent, never the person), a fix, a closing probe and evidence, recorded as an issue labelled `loop`; an audit script run every 6 hours files `fleet-audit` issues, closes them with evidence and flags a `loop` issue lacking `closing probe:`. Status: built and operating (evidence: AGENTS.md, directives dated 2026-11-06; the audit script and workflow are referenced, not staged).

### 50.5 Attribution of model calls and actions (built and operating)

[0406]A wrapper around the model binding upserts into `ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons)` with primary key `(day, worker, purpose, model)`, taking tokens from the response usage or `in_chars/4`, and `neurons = (in_tok*rate_in + out_tok*rate_out)/10^6` from a per-model table. Worked example with rates 1,818 and 6,545: 2,000 input and 300 output tokens give (3,636,000 + 1,963,500)/10^6 = 5.5995 neurons. A failure never changes the call. Actions are attributed by `human_responses.credential`, `human_actions.resolution` text naming the credential, and `cmd_log.owner`. Status: built and operating (evidence: worker.js `__aiAttrEnv`, WORKERS-AI-ATTRIBUTION-1, 2026-10-01).

## 51. Ultrastable instance and further small mechanisms

### 51.1 The Ultrastable instance (public site built; dashboard deployed, not verified live)

[0407]"Ultrastable instance" means an installation of the organization kit (section 19) whose managed organization is the Ultrastable product company, with an owner console constructed as in sections 47 to 50. A public site exists: one edge worker (version 0.1.0) serving a canonical host, two further hosts redirecting to the pilot and proof pages, a `www` redirect, pages `/`, `/how`, `/proof`, `/pilot`, `/robots.txt`, `/llms.txt`, `/sitemap.xml`, a `/health` route and a proof section read at request time from a claims interface of the host organization with fail-soft fallback text; a test asserts the redirects, at most one primary action per page, canonical links, the 404 and the offline fallback; a declaration lists post-deploy probes with mode `revert`. Status: built (evidence: ultrastable/site/worker.js, site.test.mjs, probes.json, RELEASE-0.1.0.md). The Ultrastable owner dashboard is reported by the dashboard thread as deployed but not yet verified live; its code was not present in the repository snapshot read, so it is described here as deployed, not verified live, and every feature in Table 51-1 for it is unconfirmed.

| Feature | Ultrastable domain served | Source tables |
|---|---|---|
| One-view status | core, site, pilot, patent, policy pack | program and product registers, probes |
| Owner cards and one-tap options | entity, trademark, domain, signing | `human_actions`, `human_responses` |
| One-tap questions | naming, buyers, pilot terms, credit | `owner_asks`, `product_profile` |
| Emergency pause | stop of all agent dispatch | control authority with revision |
| Proof page | public claims | claims ledger, scored predictions |

[0408]Portable hosting. Edge: a dispatcher worker with hostname and path routing (public hosts serve pages; the console path serves assets and `/api/*` behind the code sign-in), a relational database binding, a service binding to the control authority and a scheduled trigger. Container: one image of the same router on standard request and response interfaces, environment variables for the owner address and salt. GCP Cloud Run embodiment (prophetic): one service for the router and one for the control authority with service-to-service identity tokens replacing binding properties, a managed database, Cloud Scheduler for ticks, a secret manager for the salt, and an email-sending service for codes; an unreachable authority still fails closed. Status: prophetic (not yet built) for the Cloud Run variant and the container image.

### 51.2 Register of further mechanisms (each with its own status)

| # | Mechanism | Status |
|---|---|---|
| 1 | Single owner pane on own infrastructure; public side minimal, owner side complete on one deployment (read-open, controls closed, `OWNER_CLOSED_MSG`) | Built and operating (worker.js 1.96.1) |
| 2 | Hashed one-time code, preconfigured address, 10 minute lifetime, 5 tries, 6 codes/hour, 20 wrong tries/hour, session cookie | Built and operating (section 48.1) |
| 3 | Step-up within 15 minutes with in-place prompt and tap repeat; loop token cannot approve or run commands | Built and operating (section 48.2) |
| 4 | Queue split identity-bound versus fleet-handled; four-part reading per card | Built and operating (1.68.0, 1.83.1) |
| 5 | One-tap Done, Snooze 3/7 days, Not needed, I did it, Fleet: you do it, Approve, Decline; 52 px targets | Built and operating (1.71.0, 1.85.0) |
| 6 | Delegate to fleet by `/api/v3/handback`, claim before filing, dedupe, restore on failure | Built and operating (1.85.0) |
| 7 | Command line with registry, buttons as typed commands, no shell, step-up for mutations, voice transcription | Built and operating (1.70.0, 1.71.0, CMD-VOICE-1) |
| 8 | Audit rows with credential; undo of agent pull requests; SQL backups before UPDATE/DELETE | Built and operating (CMD-TASKS-UNDO-1); general inverse for every verb prophetic |
| 9 | Owner notifications: grouped new items, daily digest, dedupe key, failed-send log | Changes feed and realtime digest built; grouped email notices prophetic (not located in staged code) |
| 10 | Disclosure guard | Owner-voice guard built; page-term fetch guard prophetic |
| 11 | Public and owner sides on one deployment | Built and operating |
| 12 | Yield per $100 with push/trim levers; triage view with unmapped causes named; watchmaker index; generated changelog and architecture view | Built and operating (1.71.3, 1.74.0, 1.76.0) |
| 13 | Trusted caller properties on service bindings with forged-header test | Built (test/control.test.js) |
| 14 | Offline tests that evaluate the source itself (identity-only filter, undo wiring, morning view, voice) | Built (five test files) |
| 15 | Release notes one per line below the version line so a bump is a one-line patch; a conflict-repair script | Built (VERSION-LINE-SPLIT-1, 1.51.19, 2026-10-20; failure: 200,000 characters of notes made 12 code tasks fail on a size cap) |
| 16 | Post-deploy probe declaration with automatic revert and design lint (site) | Built (site/probes.json) |
| 17 | Hub-managed protocol block, review-by-another-agent, green-only auto-merge, issue template, deploy scripts that stop short of identity setup | Built and operating as rules; scripts not staged |
| 18 | Read-after-write guard that pins claims, locks, leases, dedupe, queue and session tables to the primary database | Built (worker.js `D1_PRIMARY_ONLY`) |

[0409]Technical effect of the group. The principal acts only on identity-bound items by taps, reversible work moves to agents in one tap without a code, every state-changing action is bound to a recorded credential, and the system fails closed when uncertain. Measurable quantities: open cards without an identity-bound line (target zero), the count of owner items versus fleet-handled items, the watchmaker index, and time from card creation to probe-observed closure.

# CLAIM-STYLE SUMMARIES

[0081] Claims are not required in a provisional application. The following describe aspects for which protection may be sought; they do not limit the disclosure.

**Independent claim A: management hierarchy**

1. A computer-implemented method comprising: storing, in a database accessible to a plurality of agent processes executing on one or more processors, persona records each associating an agent process with a role in a management hierarchy comprising a portfolio-manager role and a plurality of program-manager roles, with a program, with at least one metric, and with an enumerated set of permitted record operations; on each of a plurality of scheduled ticks, executing a portfolio-manager agent process that computes, from records of open work items and metric readings, a risk value for each program and writes an allocation record assigning to each program a number of focus slots from a bounded total, at least part of the bounded total being assigned in proportion to the risk values; on each tick, executing for each program a program-manager agent process that ranks open work items of the program in an order in which work items associated with the program's at least one metric precede other work items, selects ranked items not exceeding the program's focus slots, and writes for each selected item a priority record into a scoring table; computing, by an execution queue, a dispatch order of open work items using the scoring table and dispatching work items in the dispatch order to executor processes that generate changes to a managed computing system; and recording, for each operation performed by a manager agent process on a work item, an action record comprising the work item, the operation, a prior value and a new value, wherein each manager agent process performs only operations enumerated in its persona record.

2. The method of claim 1, wherein the risk value is a weighted sum of at least a count of open high-priority work items, a count of open work items, a count of guard-metric breaches and a count of stalled projects.

3. The method of claim 1, wherein a first portion of the bounded total is divided evenly among programs having open work items and a second portion is divided in proportion to each program's share of total risk, and wherein a program whose risk rose by more than a threshold, or whose quality index fell by more than a threshold, within a window receives an increased number of slots.

4. The method of claim 1, wherein the risk value of each program is computed once per tick and written to a snapshot table, and subsequent steps of the tick read the snapshot table instead of re-evaluating a view from which the risk value is derived.

5. The method of claim 1, wherein the ranking places work items associated with a primary metric of the program first, work items associated with a guard metric second, and remaining work items by severity and then by age.

6. The method of claim 1, wherein each priority record identifies the agent process that wrote it, and each program-manager agent process deletes only priority records it wrote and inserts without overwriting priority records written by others.

7. The method of claim 1, wherein the operations comprise closing a work item filed by a metric trigger when a reading of the metric is on target, the reading was refreshed within a window, the work item is older than a minimum age, and no remediation contract for the work item is failing, the reading being stored as closing evidence, and wherein the metric trigger files the work item again upon a later breach.

8. The method of claim 1, wherein the operations comprise lowering the priority of a work item that was filed by an agent process more than a period earlier and has no doer line and no linked session, and wherein work items filed by the principal or by a session are excluded from lowering.

9. The method of claim 1, further comprising, for a selected work item lacking a doer line for a period, requesting from a model-backed agent a target and an anchor text, validating that the target is outside excluded paths and that the anchor text occurs exactly once in the target, and either writing the target and anchor into the work item as a doer line or recording a no-fix finding with a reason.

10. The method of claim 1, further comprising, for a program having fewer than a threshold number of open roadmap work items, requesting from a model-backed agent a proposal comprising a title, a rationale, a target, an anchor and an edit, validating the proposal, and filing it as a work item from a source designated to merge on passing checks, subject to a daily cap.

11. The method of claim 1, further comprising grouping work items into families, filing a single root-cause work item at highest priority for a family whose reopenings in a window exceed a threshold, appending a diagnosis from a model-backed agent naming a producer, a closing probe and a fix, and closing the root-cause work item when the family has had no reopening or new work item for a quiet period.

12. The method of claim 1, wherein the dispatch order is computed from a score comprising a product of impact, probability, a sum of capability gain and reach gain, an inverse of remediation cost, a trust score of the surface and action class to be used, and one plus an inferred-direction confidence for the work item's category.

13. The method of claim 1, wherein each manager agent process reads a configuration record and, when the record indicates off, performs no operations on work items while continuing to compute and record risk values and allocations.

14. The method of claim 1, wherein a persona record of a separated plane is denied, by a tool layer according to the identity of the requesting agent process, read access to records of another plane.

**Independent claim B: plus loop**

15. A computer-implemented method comprising: maintaining a product register, separate from a program register, each product record comprising a usage measure, a quality measure, a last-improvement time and a state; reserving for product improvement a share of a bounded change capacity that is not reallocated to repair work items when a program risk value rises; selecting, by a product-manager agent process, a product according to at least its last-improvement time, subject to at most one improvement in flight per product; generating, by a model-backed agent from evidence read from a managed computing system and without a request to a human principal, a single additive change to the selected product and a prediction of a direction and size of change of an outcome measure; dispatching the change as a work item through a change path that deploys it to the managed computing system; upon verified deployment, storing a baseline of the outcome measure and of a guard measure; and after a measurement window, reading both measures and marking the change kept when the outcome measure improved by at least a materiality threshold and the guard measure did not regress beyond a tolerance, and otherwise filing a work item that reverts the change, wherein a missing or stale reading is treated as not improved.

16. The method of claim 15, wherein selecting weights the last-improvement time by the usage measure and by a count of open friction signals.

17. The method of claim 15, wherein a kept change causes the next change generated for the same product to be seeded with a reference to the kept change.

18. The method of claim 15, wherein a set number of consecutive changes not kept sets a rest time before which the product is not selected.

19. The method of claim 15, wherein every Nth change for a product is a simplification change that removes or consolidates an element of the product.

20. The method of claim 15, wherein, for a product whose usage measure is missing, the first change generated is a change that adds measurement of usage.

21. The method of claim 15, wherein reducing the reserved share requires a configuration record carrying an expiry.

22. The method of claim 15, further comprising writing, at an interval, a digest record listing changes shipped, kept and reverted per product, in place of a notification per change.

23. The method of claim 15, wherein the usage measure is copied from a platform request-analytics snapshot and stored as null when the snapshot is stale or missing.

**Independent claim C: earned autonomy**

24. A computer-implemented method comprising: storing, for each decision of an agent process, a prediction record comprising a subject, a comparison operator, a value and a due time; at or after the due time, reading the subject from a managed computing system and storing an observed value and a matched indicator; maintaining a trust ledger keyed by surface and action class, each entry comprising counts of verified successes and failures and a trust score computed from the counts and a prior; mapping each trust score to one rung of an ordered autonomy ladder and storing a transition record upon each change of rung; upon receiving a proposed action, determining its surface and action class and selecting an execution path according to the rung, wherein at least one lower rung requires an added review step before execution and at least one higher rung permits execution without the added review step; and executing the action through the selected path, verifying its result with at least one probe, and updating the counts.

25. The method of claim 24, wherein the trust score equals (successes + a) / (successes + failures + a + b) for positive constants a and b.

26. The method of claim 25, wherein a and b are each 5 and the rungs are bounded at trust scores of about 0.3, 0.5, 0.6, 0.7, 0.8 and 0.9.

27. The method of claim 24, wherein at a highest rung the agent processes modify their own tick procedures or policy or create new loops only through a reviewed, versioned and revertible change, and wherein no rung permits modification of platform permission checks, secret stores or a classification rule of an interrupt gate.

28. The method of claim 24, further comprising, before classifying a proposed action as irreversible, constructing a reversible form of the action by at least one of taking and verifying a backup, staging behind a flag, deploying to a canary, drafting instead of sending, or splitting the action; executing each action that is or has been made reversible without a request to a human principal; and routing to the principal only an action that remains irreversible and identity-bound, as a card comprising a default in effect, a reason and a closing probe, while continuing other work.

29. The method of claim 24, further comprising matching outputs of the agent processes against a register of signatures of deferring an executable step to a human principal, excluding outputs that state a refusal or limit with its reason, storing matches, and decreasing a trust score in response to a match.

30. The method of claim 24, wherein a conclusion of an agent process that would be output as a question or a set of options to a human principal is, when the corresponding action is reversible, executed with a recommended default and recorded with a revert path.

31. The method of claim 24, wherein the prediction record is created by a database trigger that parses a decision text of the form "<metric> <operator> <number> within <N> h".

32. The method of claim 24, wherein the trust score decays toward the prior for each tick in which the surface and action class are not exercised.

**Independent claim D: self-amending governance**

33. A computer-implemented method comprising: storing a register of signatures of output patterns of agent processes; periodically matching outputs of the agent processes and messages of a human principal against the register and storing matches; when matches of a signature from one source exceed a threshold within a window, generating by a model-backed agent an amendment proposal to a policy governing the agent processes; replaying the amendment proposal against stored records of preceding ticks to compute metrics that would have changed; and adopting the amendment through a reviewed, versioned change to the policy only when the replayed metrics improve and the amendment leaves unchanged a protected set of limits, and recording the adopted version in a lineage record.

34. The method of claim 33, further comprising red-teaming the amendment proposal with a second model before adoption.

35. The method of claim 33, wherein a single match of a friction signature in a message of the principal generates an amendment proposal.

36. The method of claim 33, further comprising, upon a refusal by a permission check or classifier whose condition lies in text written by the agent processes, correcting the condition and attempting the action once more, and otherwise recording the refusal with its reason without resubmitting the action in altered wording.

**Independent claim E: change path**

37. A computer-implemented method comprising: acquiring, by an agent process before changing a component of a managed computing system, a claim comprising a token, an expiry and a fence value greater than any previous fence value for the component, and refusing a claim on a component having an unexpired claim of another agent process; for a change touching a risk class, submitting the change to models of two disjoint model families, retaining a high-severity finding only when an evidence line of the finding occurs verbatim in the change, and refusing merge when a retained high-severity finding exists, the refusal being determined by code from the retained findings; deploying the change under a deploy lock; running probes declared for the component; and reverting the deployment when a probe that passed before the deployment fails after it, wherein the component accepts a write only when presented with the live token and the current fence value.

38. The method of claim 37, further comprising releasing expired claims by a reaper and recording a count of orphaned claims.

39. The method of claim 37, wherein the review continues without holding the merge upon an outage of a review model.

40. The method of claim 37, wherein probes whose results depend on a shared resource under load are excluded from triggering a revert.

**Further dependent claims (applicable to claims 1, 15, 24, 33 or 37)**

41. The method of any of claims 1, 15, 24, 33 or 37, wherein the scheduled ticks are produced by at least two independent schedulers and each tick stores, per step, a record of whether the step succeeded and its evidence, and wherein a time slot lacking the records is detected as a failure.

42. The method of any of claims 1, 15, 24, 33 or 37, further comprising, on each tick, identifying each work item that left an active set without a recorded disposition, recording it as an incident and reopening it.

43. The method of any of claims 1, 15, 24, 33 or 37, wherein steps routed to a human principal are held in a single queue, each as a card that closes automatically when its closing probe observes the step done, and a card lacking an identity-bound line is rerouted to the agent processes.

44. The method of any of claims 1, 15, 24, 33 or 37, further comprising a global kill-switch record that, when on, causes a claim service to refuse new claims and leases, and a drill that sets the record on for a bounded time, verifies the refusals, sets it off and records the result.

45. The method of any of claims 1, 15, 24, 33 or 37, wherein a model is selected for each task from an ordered ladder by cost and capability, a breached spending cap causes selection of a cheaper rung instead of stopping the task, and an output failing validation causes escalation by one rung within a bounded number of retries.

**Independent claim F: organization kit**

46. A computer-implemented method comprising: providing an organization-independent core comprising persona templates, charter templates, ledger schemas, tick procedures stored as data in a database, a policy, and a probe-and-revert change path; receiving a tenant configuration specifying programs with metrics, products with usage and quality measures, executors and a principal contact; connecting systems of an organization as surfaces each having declared probes; and performing the method of claim 1 for the organization without modifying the core, wherein a boundary check fails when a component is not classified as core, application or personal.

**Independent claim G: bootstrapping from an idea and a seed**

47. A computer-implemented method comprising: receiving, as the sole human input, an idea file stating an idea, intended users, first outcomes and constraints; executing, by a bootstrapper, ordered stages comprising reading the idea file and detecting available credentials and tools by presence only; selecting a model tier from a stated budget; planning an organization comprising a manager agent role for each stated outcome, a backlog of work items, scored predictions and gate cards for steps only the human can take; writing a charter, role files, agent instruction files, an autonomy policy and database seed statements; provisioning a database and a server worker having a scheduled heartbeat; and starting a first tick; and performing, on the scheduled heartbeat, the method of claim 1 for the programs and products of the charter, wherein after the starting no step executes on a computer of the human.

48. The method of claim 47, wherein a synchronization job installs the agent instruction file into the instruction location of each of a plurality of agent products only where the location is empty or carries a marker of the seed, and re-runs installation across every repository of the organization.

49. The method of claim 47, wherein pointer files direct agent products that read instruction files of other names to a shared protocol.

50. The method of claim 47, wherein a success of the bootstrapper is stored as a prediction and scored by the organization.

51. The method of claim 47, wherein a failure of a stage is recorded as a work item having an owner, a blocker and a closing probe, and later stages execute in a degraded mode.

52. The method of claim 47, wherein the model tier is selected from the budget and a reviewer model of a family different from an authoring model is designated.

**Independent claim H: autonomy policy as data**

53. A computer-implemented system comprising: a policy store holding, for each of a plurality of surfaces, a permission ceiling and, for each action class of the surface, flags indicating whether the action class is reversible and whether it is identity-bound; a validator that denies an action class that is irreversible and not identity-bound unless a reversible path is recorded; an interrupt gate that stops only an action that is irreversible and identity-bound and writes a gate card comprising a default in effect, what has been prepared and a closing probe, the gate card closing automatically when the probe observes a step of the human; harness settings for each of at least one agent product that allow actions broadly and deny the action classes that the interrupt gate holds; and a consistency test that fails when a gated action reachable by a shell command lacks a matching deny rule in the harness settings.

54. The system of claim 53, wherein a rung of a trust ladder per surface and action class is bounded by the permission ceiling of the surface and changes only by a reviewed change to the policy store and not by a tick procedure.

55. The system of claim 54, wherein a rung is promoted when a count of outcomes meets a minimum and a reliability meets a threshold with no severe failure, and is demoted when the reliability falls below a lower threshold or upon a hidden failure, a silent drop or an attempt to bypass the interrupt gate.

56. The system of claim 53, wherein standing limits comprising harness permission checks, safety refusals, a secret lock, consent and opt-out handling, a principal override and live claims of other agents take precedence over any rung.

57. The method of any of claims 47 to 52, wherein agent instruction files comprise a shared protocol and one file per role.

**System and medium claims**

58. A system comprising one or more processors and memory storing instructions that, when executed by the one or more processors, cause the system to perform the method of any of claims 1 to 57.

59. A non-transitory computer-readable medium storing instructions that, when executed by one or more processors, cause performance of the method of any of claims 1 to 57.

60. A computer-implemented method comprising: storing, in a database accessible to one or more agent processes executing on one or more processors, a register of recognitions, each recognition comprising a signature of a shape of agent output and a redirect, the register including at least a conditional offer, a question directed to a principal, a menu of options and a sentence naming the principal as the actor of a next action; for each draft output of an agent process, matching the draft output against the signatures; for each match, classifying the match as excluded when the draft output states a refusal or limit with a reason, when a stop is irreversible and identity-bound with no reversible form constructible by the system, or when the step is held by a live claim of another agent process, and otherwise as a false stop; for a false stop, rewriting the draft output according to the redirect, executing and verifying the abandoned action in the same output cycle, and emitting the rewritten output as done; and writing a hit record for each match and reducing a trust value associated with a surface and an action class by a weight associated with the signature.

61. The method of claim 60, wherein, for an excluded match, the draft output is emitted as a disposition identifying an owner card, issue or claim and a closing probe, and the hit record is written with an excluded indicator and a reason.

62. The method of claim 60, wherein the redirect for a conditional offer or a question is to execute the action in the same output cycle and report it as done, the redirect for a menu is to select one option and mark the others as superseded, and the redirect for the sentence naming the principal as actor is to rewrite the sentence in the first person and execute the action, dispatch it to an executor from a roster if it cannot be executed, and escalate it through the agent processes if it cannot be dispatched.

63. The method of claim 60, further comprising, when a match indicates a blocker accepted without surface coverage, enumerating surfaces that provide a distinct path to the same outcome, testing each untested surface, and reporting the blocker, with the list of surfaces tested, only after every surface has failed.

64. The method of claim 60, further comprising, when a signature produces at least a threshold number of hit records within a window from one source, writing a proposal record comprising a proposed rule, testing the proposed rule against a second model for harm to a protected limit, replaying stored hit records and decisions of trailing ticks as if the rule had been in force, and, when the replay improves at least one metric and worsens none beyond a tolerance, adopting the rule by a reviewed change to the register and incrementing and recording a version.

65. The method of claim 60, wherein the recognitions are further carried in instructions of each of a plurality of model-backed agent processes, and wherein an hourly scan of stored outputs of the agent processes writes the hit records, excluding outputs that state a refusal or limit with a reason.

66. The method of claim 60, wherein the weight for a conditional offer is 0.10, for a report ending in a question is 0.05, for a sentence naming the principal as actor is 0.15 and for narration instead of production is 0.10, and wherein the trust value is clamped to an interval from 0 to 1.

67. A system comprising one or more processors and memory storing instructions that, when executed, cause the one or more processors to: execute a repeating tick comprising an ordered list of steps including reconcile, recognize-and-redirect, pull from a driver, dispatch or execute, verify, compare a prediction, accrue trust and evolve policy; write, for each step of each tick, an evidence record comprising a tick identifier, a step, a result and a time; maintain a trust value for each pair of a surface and an action class, starting at a baseline, decreasing by a decay for each tick in which the pair is not exercised, increasing by weights for verified autonomous actions and clean self-remediations, and decreasing by weights for questions to a principal, handoffs to the principal, silent drops and hidden failures, the weight for a hidden failure exceeding each increasing weight; map the trust value to a position on an ordered ladder of scopes and store a transition record upon a change of position; and permit scope changes by the ladder only through a reviewed and revertible change path, and permit no position on the ladder to change a permission check, a secret store, an interrupt gate or an alignment floor.

68. The system of claim 67, wherein the baseline is 0.5, the decay is 0.01 per unexercised tick, and the weight for a hidden failure is 0.30.

69. The system of claim 67, wherein the instructions further cause the one or more processors to compute a rate of ticks having all expected evidence records in a window and to file a work item when the rate is below a target.

70. The system of claim 67, wherein the instructions further cause the one or more processors to multiply a priority of a work item by the trust value of the pair of the surface and action class the work item will use.

71. The system of claim 67, wherein the interrupt gate pauses only for an action that is irreversible and identity-bound after an attempt to construct a reversible form, and a paused action is reported as a card comprising an identity-bound line, a default in effect and a closing probe, and wherein a card lacking the identity-bound line is rerouted to the agent processes.

72. A computer-implemented method comprising: storing a mandate under which each accepted work item proceeds through decide, implement, deploy and verify stages; storing, for each stage of each process, a time budget; filing a work item when an elapsed time of a stage exceeds its budget and writing one blocking question when the elapsed time exceeds twice the budget; storing for each process a single definition of done with an evidence requirement and at least a primary path, a remediation path and a workaround path ending in the same definition of done; and rejecting a process definition having exactly one path for a step.

73. The method of claim 72, further comprising pulling every open agent-owned row having a due date beyond a first limit from its open date to the first limit, except rows exempt as calendar-bound, event-gated or rate-limited, and verifying that each open row has a dated schedule trigger or a durable-job executor.

**Independent claim (additional family):**

74. A computer-implemented method comprising: starting, by a first scheduler and by a second scheduler that share no process and no next-fire state table, a recurring procedure of a plurality of agent processes executing on one or more processors, each start causing the recurring procedure to write, per step, a record having a start time and a success indicator to a run ledger; reading, by an executor, a task row from a task table, executing the task by a type recorded in the task row, and updating a run record in the run ledger from a queued state to a running state and then to an ok state or a failed state; computing, for each recurring procedure and a window, expected time slots from a schedule expression of the procedure; counting, per time slot, run-ledger records written by each of the first scheduler and the second scheduler; and when a time slot has no record, opening a work item in a work ledger naming the procedure, the time slot and the scheduler that declared the procedure, and assigning the work item a first priority when no record exists from either scheduler and a lower second priority when a record exists from only one of them.

75. The method of claim 74, wherein the second scheduler reads, at a fixed interval, rows of a cron table that are enabled and whose next-fire time is null or not later than a present time, computes a next-fire time from a five-field schedule expression by testing successive minutes against the fields, and writes the next-fire time to the row whether or not the post to the executor succeeded.

76. The method of claim 74, further comprising taking, by the recurring procedure, a work claim before acting so that a second start for the same time slot ends without acting.

77. The method of claim 74, further comprising checking, for each batch of items scanned by the executor, that a count of items executed plus a count failed plus a count handed to a person plus a count found to need no action equals a count scanned, and recording a failure when the equality does not hold.

78. The method of claim 74, further comprising, after each completed task, building an event envelope having a schema version, a kind, a timestamp and provenance comprising an emitter and a hash of a payload, validating the envelope with a deterministic validator before storage, and storing the envelope with an accepted or a rejected status and a validation error.

79. The method of claim 74, wherein each agent process is a member of a fleet having a worker contract comprising a version constant, a health route, a canonical source copy compared byte for byte with a deployed copy, and a registry row, the method further comprising reconciling deployed members to the registry at an interval and labelling each member as live, drifted, degraded, paused or retired.

80. The method of claim 74, wherein the first scheduler is a native per-member cron trigger of an execution platform and the second scheduler is a dispatcher reading a cron table, so that a schedule is changed by writing a row without redeploying a member.

**Independent claim (additional family):**

81. A system comprising one or more processors and memory storing instructions that, when executed, cause the one or more processors to: enumerate, through a platform interface, deployed members of a fleet and record for each member its bindings by type, including service bindings naming a target member; build a directed graph whose edges are the service bindings; compute for each node an in-degree and an out-degree and label a node an island when both are zero, a sink when only the in-degree is nonzero and a source when only the out-degree is nonzero; label an edge target unresolved when the target is absent from the graph and from a registry; compute a directed density as a count of edges divided by n times n minus one for n nodes; compute counts of ghosts present in the registry and not deployed, unregistered members deployed and not in the registry, and unversioned members; store a composite integration score with the counts in an integration state table; compute from the integration state table and an operational state a plurality of dimension scores each stored with an evidence pointer and a confidence, and a mean of the dimension scores; render the scores to a dashboard and to an owner digest generated from the same stored state; and open a work item in a work ledger for each dimension whose score fell by at least a threshold without a recorded cause.

82. The system of claim 81, wherein the instructions further cause the one or more processors to build a producer-consumer map of tables, and to open a work item for each table having a non-empty writer set and an empty reader set.

83. The system of claim 81, wherein the instructions further cause the one or more processors to store, for each member, a measured daily activity and to label a member unmeasured, and not idle, when it is absent from the activity table, and to retire a member only after the activity table has been extended to cover it.

84. The system of claim 81, wherein the dashboard exposes an executor self-report comprising counts of items scanned, executed, failed, handed to a person and found to need no action.

85. The system of claim 81, wherein the instructions further cause the one or more processors to compute an objective value as a weighted sum of a loop closure rate, minus a drift count, minus a count of human interventions, minus a cost overrun, minus an integration gap, plus a throughput.

86. The system of claim 81, wherein the instructions further cause the one or more processors to assign each open row a time to resolution from a severity, to cap the due date of an open row at a maximum number of days from a present time unless the row is exempt, and to raise the priority of a row that is past due.

87. The system of claim 81, wherein the instructions further cause the one or more processors to store signals having a source, a content and an evidential weight, to permit a worker to consume a signal only when a row of a boundary table lists the worker, the source and a domain as permitted, denying otherwise, and to convert a deposited artifact into a signal whose payload is an open-question set and whose weight is zero when the open-question set is empty.

88. A method performed by one or more processors of a system that operates an organization for a principal, the method comprising: reading a set of ratified objectives from an objectives store writable only by a ratification action of the principal; gathering candidate signals from records of the organization; generating, by an agent process, candidate goal statements each having a falsifiable definition of done; classifying each candidate goal as an instrumental goal or as an objective revision; writing each objective revision with a proposed status and a principal-ratification owner in a ratification queue, without adopting it; for each instrumental goal, computing a score, rejecting the goal when the score is below a threshold or when a similarity of the goal to a goal adopted within a window is at or above a similarity threshold, and otherwise determining whether a ratified objective anchors the goal; adopting an anchored goal as a derived goal recorded with a parent objective, an alignment statement and the definition of done, and writing the derived goal to a ledger read by a scheduled consumer; storing an unanchored goal as a novel goal on probation; and retiring a goal with a recorded reason when its definition of done is met, when it has been active longer than a stale limit, or when it is superseded.

89. The method of claim 88, wherein the similarity is the greater of a Jaccard similarity and a containment similarity of token sets, and the similarity threshold is at least 0.5.

90. The method of claim 88, wherein adopting is limited to a cap on the number of derived goals per cycle, the derived goals being adopted in order of score.

91. The method of claim 88, further comprising, for a novel goal, withholding dispatch to executors having write authority, counting novel goals past a review deadline, and on ratification by the principal writing the novel goal into the objectives store as a standing objective.

92. The method of claim 88, wherein the authoring is executed under an authentication check on mutation requests and wherein an attempt to give an objective revision an adopted status is converted to the proposed status.

93. The method of claim 88, further comprising, for each issue category in which the principal filed at least a minimum number of work items in a window, writing an inferred-direction row with a confidence, and multiplying a queue score of work items in the category by one plus the confidence, wherein the inferred-direction row does not alter the ratified objectives or any authority limit.

94. The method of claim 93, further comprising recording a positive trust event when a work item in an inferred category is completed and not reversed by the principal, and a negative trust event when it is reversed.

95. A system comprising one or more processors and memory storing instructions that, when executed, cause the one or more processors to: store work items each having an identifier, an owner role, at least one trigger identifier, a done check and a milestone; evaluate, for a work item in a backlog state, whether every trigger identifier names an item in a done state or an open gate, and place the item in a blocked state recording the blocking identifier when not, and in a ready state when so; place a ready item in an in-progress state on a claim by a doer in the owner role, the claim being released after an idle expiry; place an item whose next step is identity-bound in a principal queue with a default, a reason and a closing probe; hand an item asserted done to a reviewer role distinct from the doer; execute the closing probe named in the done check, placing the item in a done state with stored evidence on a pass and returning it to the in-progress state on a failure; and on entry of an item to the done state, re-evaluate each item naming the identifier of that item as a trigger.

96. The system of claim 95, wherein the instructions further cause the processors to record, for each item that leaves an active set, a disposition of done, superseded or cancelled with a reason.

97. The system of claim 95, wherein the identifier is a code comprising a portfolio, a program, a project and a phase, and wherein the instructions cause a plan step of an agent to carry the code and a status reflecting the state of the item.

98. The system of claim 95, wherein the instructions further cause the processors to write state changes to a canonical database and to mirror them, in the direction from the database to a project board only, by updating labels and a milestone of a mirrored issue, adding a sync label and writing an audit row.

99. The system of claim 95, wherein the instructions further cause the processors to compute a count of stalled projects, a project being stalled when it has open items, no item has changed state within a number of days, and no claim is held, and to add a weighted count to a risk value of a program.

100. A non-transitory computer-readable medium storing instructions that, when executed, cause one or more processors to: register an experiment having a hypothesis, a treatment, a control, an outcome metric and a window; read counts for the treatment and the control over identical calendar windows from stores of externally attributable signals; combine at least two independent signals, or extend the window, when a single signal cannot reach a significance level within the window; stop the experiment at the earliest of the close of the window, a breach of a guard metric, and a futility bound; and promote the treatment to standard operating procedure when it shows a positive delta on at least two metrics, and otherwise drop it with a written rationale.

101. The medium of claim 100, wherein the instructions further cause the processors to filter every candidate suggestion for a surface on a server by a deny list, a deny-word expression and a command-shape expression before return, the candidates being drawn only from sources of the domain of the surface.

**Independent claim (additional family):**

102. A computer-implemented method comprising: (a) maintaining, in a database, a capability matrix keyed by task class and model that records for each model a result of a capability test for the task class; (b) receiving a task having a task class; (c) determining whether an answer to the task is computable by a deterministic handler and, if so, returning the answer without a model call; (d) otherwise selecting, from rungs of the capability matrix for the task class whose capability test results are passing, the rung of lowest cost; (e) when a spend cap for the task class or for an organization is breached, selecting a cheaper rung, including a free rung where one exists, instead of ending the task; (f) executing the task on the selected rung and validating the output against a schema and at least one deterministic check; (g) when the validation fails, selecting the next rung and re-executing within a bounded number of retries; and (h) recording a cost per verified outcome for the task class.

103. The method of claim 102, wherein the cost per verified outcome is the spend attributed to tasks of the class divided by the number of those tasks that passed the validation, and an escalation rate is recorded as the share of tasks that reached a last rung.

104. The method of claim 102, further comprising, before executing, looking up a cache and serving a cached answer only if the cached answer has not been invalidated by a change to its source.

105. The method of claim 102, wherein the capability test comprises at least one of tool-call validity, schema conformance and context size, and the cost of a model is used only to order models that have passed.

106. The method of claim 102, further comprising refusing to install a cost guard on a path until a resolved upstream model of the path has been probed and found to be cheaper than the model the guard would select.

**Independent claim (additional family):**

107. A system comprising a processor and a memory storing instructions that, when executed, cause the processor to: (a) scan repository sources and deployed bundles of a plurality of workers for references to models in a banned list, skipping comment-only lines carrying a marker, and file a work item for each worker having a match; (b) for a candidate model and a task class, test the candidate against a minimum context window and a minimum output length, rejecting it unless it meets them or is registered in an exemption registry with evidence; (c) run a capability test and a label agreement check in which the candidate answers a sample of questions drawn from a store of labels of an organization and an agreement fraction is computed; (d) admit the candidate to a task matrix for the class only if a lower confidence bound of the agreement fraction is at or above a gate for the class; (e) monitor the admitted candidate by scheduled tests and a shadow sample of production decisions; and (f) demote the candidate and revert routing to a next passing rung when rolling agreement falls below the gate by a margin or a capability test fails repeatedly.

108. The system of claim 107, wherein the sample has at least a minimum size below which the agreement check returns inconclusive.

109. The system of claim 107, wherein a candidate rejected for the class is retained with its measured agreement and is evaluated separately for other task classes.

110. The system of claim 107, wherein the instructions further cause the processor to adjust a configuration only through an allowlist of reversible actions, to verify each adjustment on a next scheduled run, and to revert it on regression, using baselines that are moving averages with thresholds adapted to variance.

111. The system of claim 107, wherein the instructions further cause the processor to group stored predictions by stated confidence, compute for each group a hit rate, and lower a confidence cap applied to a decision type by the gap between stated confidence and hit rate.

112. The system of claim 107, wherein the instructions further cause the processor to classify a request by a deterministic function of a last user turn as code, operations or chat, with ambiguous requests classified as operations or chat, and to serve code requests by a model restricted to a code toolset that executes only in a sandboxed server-side runtime.

113. The system of claim 107, wherein the instructions further cause the processor to dispatch work through executor adapters of a plurality of kinds, each taking a claim on a path in one claim ledger, and to select an executor whose trust, keyed by executor, surface and action class, meets a required rung, the effective rung being the minimum of the executor rung and the surface rung.

**Independent claim (additional family):**

114. A computer-implemented method comprising: reading, by an audit agent executing on one or more processors, live state of a managed system together with a clock value read from the managed system in the same call that produces the evidence; writing a plurality of findings to a database, each finding comprising a claim, evidence, an evidence read time, a falsifier and a state; re-testing each finding by a path independent of the path that produced it and setting the state of the finding to verified when the claim reproduces; for a finding that does not reproduce, writing a correction record that identifies the superseded finding, retains the superseded finding, and states a control observation that falsified it; for a finding that reproduces, performing an action on the managed system and recording a claim state of the action selected from code-only, staged, inferred and observed; and closing the finding only when the claim state is observed by a deciding query that reads the managed system, and otherwise setting the finding to pending with the deciding query, a pass condition and a fail condition, and re-testing the finding at a later time.

115. The method of claim 114, wherein the claim state is inferred when the managed system shows an expected effect only by the absence of failures, and the finding is closed with a label identifying the inference and a scheduled re-test.

116. The method of claim 114, further comprising writing a capstone record that groups findings by a shared structural cause and compares the structural cause with at least three independently derived rosters of the managed system.

117. The method of claim 114, further comprising, before accepting a claim that work cannot proceed: enumerating a plurality of surfaces, each surface being a distinct path to the same outcome; testing each surface and recording the test and its result; and marking the claim proven only when each surface returned a refusal attributable to that surface.

118. The method of claim 114, wherein the claim states code-only, staged, inferred and observed correspond respectively to a map rung, a bridge rung, a bridge rung and a territory rung of a map-territory scale, and a claim lacking a deciding query or a null expectation is demoted one rung.

119. The method of claim 114, further comprising: computing, by set difference between a repository registry and a deployed registry, the share of measured traffic of workers that would cease to be measured if the repository registry were deployed; and withholding deployment of the repository registry when the share exceeds a threshold.

**Independent claim (additional family):**

120. A system comprising one or more processors and memory storing instructions that, when executed, cause the processors to: store a failure mode register of rows each comprising a detector statement, a threshold and a severity; execute each detector on a schedule and write an evidence row for each execution whether or not the detector fires; on a firing, open an item carrying a remediation contract comprising an owner, a doer, a trigger, a closing probe and a retry bound; execute a remediation consumer that books, for each scanned item, one outcome bucket selected from executed, failed, needs-human and no-action; compute a gap equal to the number of scanned items minus the sum of the outcome buckets; and, when the gap exceeds zero, open a silent-drop incident, reopen the scanned items having no disposition, and block closure of parent items of the scanned items.

121. The system of claim 120, wherein the instructions further cause the processors to count attempts per target and error signature and, when the count reaches a threshold, suspend retries of the target, file a root-cause item, and schedule a half-open probe at a longer interval.

122. The system of claim 120, wherein a detector for a stopped writer computes an age as the difference between a current time read in the same statement and a newest write time of a table, normalizes timestamp formats before comparing, and fires when the age divided by an expected interval exceeds a threshold.

123. The system of claim 120, wherein the instructions further cause the processors to compute a set of emitters observed in an alert table and to fire when the set of emitters includes a name absent from the union of a service registry and a live script list.

124. The system of claim 120, wherein the instructions further cause the processors to compute a visibility ratio equal to the number of open items across a plurality of issue stores divided by the number of open items visible to operating tools, and to fire when the ratio exceeds a threshold.

125. The system of claim 120, wherein the instructions further cause the processors to set a detector to probation when the share of its firings confirmed by verification records over a window is below a threshold.

126. The system of claim 120, wherein at least one detector is executed by a worker other than the worker that writes the table the detector reads.

**Independent claim (additional family):**

127. A computer-implemented method comprising: reading, by a bootstrapper executing on one or more processors, an idea file stating an idea, intended users, first outcomes and a monthly budget, an organization configuration file, and an autonomy policy file that states for each of a plurality of surfaces a permission ceiling, a start rung of an autonomy ladder, and for each action class of the surface a reversible flag and an identity-bound flag; validating the autonomy policy file and, for each action class that is irreversible and not identity-bound, requiring a reversible path or a denial; determining, for each of a plurality of connectors named in the organization configuration file, only whether a corresponding environment variable is set; for each connector not set and not marked optional, creating a gate card comprising a statement of what is asked, a reason, a default in effect and a closing probe naming the variable; selecting, from a ladder of budget tiers, the tier having the greatest minimum budget not exceeding the monthly budget; instantiating role records, comprising one project-manager record and one product-manager record for each first outcome, and work items comprising a kit backlog and one item per first outcome, each having an owner role, a done check and a closing probe, and a prediction having a metric, an operator, a target and a due time; and writing seed statements that insert the role records, work items, gate cards, the prediction and a trust-ledger row for each surface and action class, each insert being ignored if its key exists; wherein each stage of the bootstrapper executes inside a guard that, on an exception, records the stage as blocked and creates a work item having a priority higher than the kit backlog, an owner role and a closing probe, and the bootstrapper continues with later stages and returns a first exit code if no stage is blocked and a second exit code otherwise; and executing, by a worker on a schedule, a tick comprising a plurality of steps each inside a guard, the steps comprising: reopening any work item that left an active set without a disposition and recording a silent-drop outcome; releasing claims whose heartbeat is older than a time-to-live; closing a gate card when its closing probe shows that the principal's step is done; scoring each prediction whose due time has passed by comparing a value of the named metric with the target using the operator and storing a hit or miss, an unknown metric being scored a miss; and dispatching to each role whose tick interval divides the tick number the highest-priority ready work item of its owner role not already claimed.

128. The method of claim 127, wherein the tick further computes, for each pair of surface and action class, a reliability equal to a count of verified outcomes plus the product of a baseline and a prior weight, divided by a count of outcomes plus the prior weight, and, when the count of outcomes is at least a minimum, the reliability is at least a promotion threshold, no severe outcome exists, and a current rung is below the ceiling of the surface, opens a work item requesting a reviewed change to the autonomy policy file moving the rung, without changing the rung in the trust ledger.

129. The method of claim 128, wherein the ceiling of a surface having a permission of propose is a rung below the rung at which an agent executes without review, and wherein a demotion item is opened when the reliability is below a demotion threshold or any severe outcome exists.

130. The method of claim 127, further comprising testing that each shell command pattern listed for a gated action of the autonomy policy file appears in a deny list of harness settings of a coding-agent product, and failing the test otherwise.

131. The method of claim 127, wherein the selected tier determines a model for each of a doer, a reviewer and a manager, and wherein the number of instances of a pooled role is a first number when the monthly budget is below a threshold and a second number otherwise.

132. The method of claim 127, wherein the first exit code and the second exit code allow a continuous-integration job to distinguish a complete boot with degraded stages from a boot having a blocked stage, and wherein the records of a blocked boot are retained.

133. The method of claim 127, wherein the prediction states that a count of ticks having all steps completed within one hour is at least a number equal to the number of tick intervals in one hour, and the method further comprises serving a health response having a failure status when the most recent tick did not complete all steps.

**Independent claim (additional family):**

134. A system comprising one or more processors and memory storing instructions that, when executed, configure the processors to: read a boundary manifest assigning each of a plurality of deployed workers to exactly one of a core class, an application class and a personal class and listing core scripts, core workflows and core tables; enumerate live workers as directories of a repository that contain a worker entry file and no retirement marker; add a violation for each live worker absent from the manifest, each manifest worker that is not live, each entry having an unknown class or no role description, and each listed path that does not exist; and fail a change when a violation exists; store a plurality of product claims, each comprising a sentence and a probe consisting of a single read-only query returning an expected value, an observed value and a detail text; execute each probe when the sentence is displayed; create for each product claim a remediation contract that repeats the probe at a cadence, with a maximum number of attempts and an escalation target; reject any probe that is not a single query; and update a product claim and its remediation contract in the same change.

135. The system of claim 134, wherein the instructions further configure the processors to fail a build when claim identifiers named in the boundary manifest differ from identifiers of stored probes.

136. The system of claim 134, wherein the instructions further configure the processors to record, for the change that creates the claims, a prediction of a pass share of claim verifications within a window, and to treat a failing claim as requiring the claim to be removed or the system to be corrected.

137. The system of claim 134, wherein a manifest entry carries an entangled note naming code of a different class sharing a file with the worker.

138. The method of claim 127, further comprising installing the organization for a tenant by executing a command that verifies digests of files of a signed bundle of an organization-independent core against a manifest, stops on a mismatch, runs the bootstrapper, calls a provision port of a runtime adapter to create a database and apply additive migrations, binds connectors by name, deploys a worker with the schedule, waits for a first tick, and registers the tenant, and wherein re-running the command performs only steps whose probes fail.

139. The method of claim 138, further comprising, for each pair of tenants, writing a canary row through the credentials of a first tenant, attempting with the credentials of a second tenant to read the first tenant's database, and recording a severe outcome on a tenant-isolation surface when the read is not denied or returns the canary row.

140. The method of claim 127, wherein the tick calls a store port, a schedule port, a secrets port, a model port, a deploy port and a health port of an adapter interface implemented for a runtime selected from an edge platform, a cloud provider platform and a container orchestrator, and wherein a candidate adapter is accepted when tick tests pass against its store handle.

141. The method of claim 140, wherein the schedule port inserts a tick record having a unique slot value equal to an integer quotient of the current time by the tick interval and returns without executing the tick when the insert conflicts.

142. The method of claim 140, wherein the deploy port directs a portion of traffic to a new revision, runs probes against the revision, and returns the traffic to a prior revision when a probe that passed before the deploy fails after it.

143. A computer-implemented method comprising: in response to a code request, refusing when a count of codes created in a first window reaches a first limit or when a code was created less than a minimum gap earlier; otherwise generating a one-time code, storing only a hash of the code combined with a row identifier and a server secret together with an expiry, and emailing the code only to a preconfigured owner address that is not taken from the request; in response to a submitted code, refusing when a sum of failed tries in a second window reaches a second limit, comparing hashes of the submitted code against unused unexpired rows whose tries are below a per-code limit, marking a matching row used by a conditional update so that the code works once, and creating a session whose random token is stored only as a hash with a session lifetime and a verification time; and, for a state-changing request, requiring the session and, when the request is destructive and the verification time is older than a step-up window, returning a response requiring a fresh code, prompting for the fresh code in place and repeating the request after the fresh code is verified.

144. A system comprising a processor and memory storing instructions that configure the processor to: store owner cards, each with a title, a reason, a default in effect, an action, a severity and a status; exclude from an owner count and display separately as handled by the fleet any item whose source is a fleet loop, while retaining items having an identity-bound line as owner items; display for each owner card buttons including a fleet hand-over button, a snooze button, an I-did-it button and a not-needed button; on a tap of the hand-over button, claim the card by a conditional status update from open to rerouted, then file a work item whose text includes the card's title, reason and action and a definition of done, restoring the card to open if filing fails; on a tap of the I-did-it button, file a work item asking the fleet to verify the step and close the card with evidence; leave the default in effect when no tap occurs; and record for each decision a credential identifying the kind of authority presented.

145. The method of claim 143, wherein a machine loop token is permitted to file and clear queue entries but is refused when it attempts to run a console command, approve a decision or hand work back to the fleet.

146. The method of claim 143, wherein typed commands and button taps are executed through one registry in which each verb has a destructive flag, a command is recognized only when it stands alone or names its target so that a sentence merely containing the verb is routed to a model path, and no verb executes an arbitrary shell command.

147. The method of claim 146, further comprising receiving a recording of at most a size limit, requiring the session, transcribing the recording with a first speech model and, on failure, a second speech model, and entering the text into the same typed line.

148. The method of claim 143, further comprising writing, for each command and each decision, a log row naming the credential, and reversing a change on request by reverting an agent-authored pull request after a step-up check, and backing up rows before an update or delete statement.

149. The method of claim 143, wherein the owner address is displayed only in masked form and a delivery outcome of each code is stored with the code row.

150. The system of claim 144, wherein a tap on an option of a stored question having two to four options and a not-sure option sets an answer, and a trigger that writes only a table without triggers applies the answer to a record read by a public page, which falls back to defaults when the table is unreadable.

151. The system of claim 144, wherein a view lists answered questions for which no work item exists and a sweep files one work item per listed row.

152. The system of claim 144, wherein the instructions further configure the processor to, before creating a card, test whether a reversible form of the step is constructible in scope and, if so, execute it and record a disposition instead of creating the card.

153. The system of claim 144, wherein the instructions further configure the processor to compute a watchmaker index as a count of recurring operations that need a person, each operation having a query proving its last run, and to list an operation whose measurement is missing as unmeasured.

154. The system of claim 144, wherein the instructions further configure the processor to serve a triage read that maps each breaching metric to a root cause, names breaching metrics mapped to no cause without counting them as zero, and serve a value view in which a yield is outputs per currency unit of spend over a window and a change counts only if the yield rose, quality did not fall and spend stayed within a budget.

155. The system of claim 144, wherein each model call is recorded into a counter table keyed by day, worker, purpose and model by an upsert, with tokens taken from response usage or estimated from input length, and a failure of the recording does not alter the call.

156. The system of claim 144, wherein before each model call and tool dispatch a fresh state is requested from a control authority over a service binding whose caller identity is a trusted binding property, dispatch is permitted only on a valid not-paused response, and a resume is applied by compare-and-set on a revision.

157. The system of claim 144, wherein the instructions further configure the processor to compute, for each of a plurality of products, checks of an assigned manager, a portfolio entry and a director from written registers and to return a failing exit code when a live product lacks an assigned manager.

# ABSTRACT

A system operates an organization through a hierarchy of virtual staff agents, each defined by a persona record with a role, a program, metrics and an enumerated set of permitted operations. On scheduled ticks a portfolio-manager agent allocates bounded focus capacity across programs by risk, and program-manager agents rank and focus work, writing priority records that an execution queue uses to dispatch work to executor processes, with each operation recorded with its prior value. Each decision carries a machine-readable prediction that is later scored; a trust ledger per surface and action class maps verified outcomes to an autonomy ladder that selects each action's execution path. A plus loop reserves capacity for evidence-driven, additive changes to working products and keeps a change only when its outcome improves without guard regression. Only irreversible, identity-bound steps reach the human principal. Changes run under fenced claims, two-family review and probe-triggered revert, and the governing policy amends itself from recurring output signatures.
