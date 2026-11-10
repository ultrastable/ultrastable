---
title: "PROVISIONAL APPLICATION FOR UNITED STATES PATENT"
subtitle: "Systems and Methods for Operating an Organization Through a Hierarchy of Virtual Manager Agents With Closed Feedback Loops, Scored Predictions, Earned Autonomy, and Evidence-Driven Additive Improvement"
---

**DRAFT FOR REVIEW BY A REGISTERED PATENT PRACTITIONER. NOT LEGAL ADVICE.**
Draft version 2, prepared 2026-11-10. Inventor: Rowan [full legal name, city, state and citizenship to be completed on the cover sheet]. Working product name: Ultrastable.

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

# ABSTRACT

A system operates an organization through a hierarchy of virtual staff agents, each defined by a persona record with a role, a program, metrics and an enumerated set of permitted operations. On scheduled ticks a portfolio-manager agent allocates bounded focus capacity across programs by risk, and program-manager agents rank and focus work, writing priority records that an execution queue uses to dispatch work to executor processes, with each operation recorded with its prior value. Each decision carries a machine-readable prediction that is later scored; a trust ledger per surface and action class maps verified outcomes to an autonomy ladder that selects each action's execution path. A plus loop reserves capacity for evidence-driven, additive changes to working products and keeps a change only when its outcome improves without guard regression. Only irreversible, identity-bound steps reach the human principal. Changes run under fenced claims, two-family review and probe-triggered revert, and the governing policy amends itself from recurring output signatures.
