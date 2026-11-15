# CLAIM-TO-CODE: Ultrastable claims against qnfo-workers

Generated 2026-11-10 for the patent attorney and the extraction effort. Source: qnfo-workers HEAD `3eef0c5a00207b16c033acadf936f7a84c074860` (local checkout, 2 commits ahead of origin/main at the time of reading). Claim numbering: the OLD numbering of ultrastable-patent/provisional-specification.md (independent claims 1, 15, 24, 33, 37, 46, 47, 53; families A-H of CLAIM-STRATEGY.md). The newer draft in ip/provisional/ has eleven independent claims with different numbers (1, 21, 35, 46, 57, 70, 82, 93, 105, 116, 127); a crosswalk is at the end.

How to read: paths are relative to qnfo-workers. "SQL-only" means the logic is a table, view, trigger or a `fleet_tasks` workflow definition stored as JSON inside a migration, run by the fleet-exec task runner, not a worker.js function. "rc" = this repo (repo-clone). Status words: IMPLEMENTED LIVE = read in code or SQL and in a migration that the canonical path applies; PARTIAL; NOT IMPLEMENTED = designed in the spec, absent in qnfo-workers; NOT FOUND = looked for and could not locate (absence of evidence, not proof). Rows marked "not line-verified" were not opened at the portable side. Verification depth: the three family fragments were produced by reading the named files; spot checks of deploy-guard line numbers (acquireLease 563, liveFence 686, fence allocation 742-744), review_gate.py (added_lines 133, classify 141, vet 267) and deploy_probes.py (TRANSIENT 73) matched.

Correction found while merging: the E-fragment first said the fence allocation was not located; it is qnfo-deploy-guard/worker.js:742-744 (`SELECT COALESCE(MAX(fence), 0) + 1 ... FROM work_claims WHERE path = ?1`, then INSERT with `fence`). That row is therefore IMPLEMENTED LIVE for allocation; component-side enforcement remains PARTIAL (the guard validates, the writing component is not shown to).

## Family A: management hierarchy (claims 1-14)

Source: qnfo-workers HEAD 3eef0c5. All paths relative to that repo. Manager steps are `fleet_tasks` workflow definitions stored as JSON data inside migrations (SQL-only; executed by the fleet-exec task runner, not by worker.js). Portable equivalent `engine.py` = repo-clone/platform/core/ultrastable/engine.py; `tick.js` = repo-clone/seed/worker/src/tick.js.

| Claim element | qnfo-workers location | Status | Entanglement | Portable equivalent / GAP |
|---|---|---|---|---|
| 1: persona records (role, program, metric, enumerated ops) | Table `management_personas` has NO CREATE in migrations (pre-existing in qnfo-audit; described in migrations/2026-10-26-management-personas.sql:1-40 header); `program_charters`, `fleet_agents` likewise | PARTIAL (rows live, DDL not in repo) | SQL-only | `orgchart.py` (role config); no enumerated-ops column: GAP |
| 1: portfolio manager computes risk per program | migrations/2026-10-26-management-personas.sql:120-130 `v_program_risk` (3*high + 0.3*open + 15*guard_breaches + 2*stalled_projects) | IMPLEMENTED LIVE | SQL-only (program codes, charters are QNFO) | `engine.py` `portfolio` step (weights by project, not risk): PARTIAL |
| 1: allocation record, bounded slots, part by risk | `portfolio_allocations` (management-personas.sql:59-72); latest `v_portfolio_allocation_plan` migrations/2026-11-04-north-star-managers.sql:333-~385 (ops_config `persona_focus_slots` default 25, half even, half by risk) | IMPLEMENTED LIVE | SQL-only; north-star bonus is QNFO-specific | `engine.py` `portfolio` (alloc by weight, `plus_slots`): PARTIAL; no risk formula: GAP |
| 1: program manager ranks, metric-linked first, selects up to slots | `v_program_focus_candidates` (management-personas.sql:168), `v_program_focus_plan` (:189), tables `program_focus` (:74), `program_focus_log` (:86), `program_focus_plan_now` (:98); slot join at north-star-managers.sql ~:325-331 | IMPLEMENTED LIVE | SQL-only | `engine.py` `execute` orders by priority only: GAP (no metric tier) |
| 1: priority record in scoring table | `issue_priority_scores` (created 2026-10-12-21-tick-driver-roster.sql:55; manager writes impact 5/prob 5/gain 5/5/cost 1, `scored_by` = `program-manager:<code>`) | IMPLEMENTED LIVE | SQL-only | GAP |
| 1: execution queue dispatch order from scoring table | `v_issue_queue_v2` tick-driver-roster.sql:79-105 (ORDER BY prank=0, aged, score) | IMPLEMENTED LIVE | SQL-only | `engine.py` `execute` (ORDER BY priority): PARTIAL |
| 1: action record with prior and new value | `persona_actions` (management-personas-2.sql:55-64: persona_key, kind, issue_id, from_value, to_value, evidence, reverted_at) | IMPLEMENTED LIVE | SQL-only | store events table records events without prior value: PARTIAL |
| 1: tool layer denies ops not enumerated in the persona record, by identity | grep of qnfo-tools-mcp, qnfo-deploy-guard, qnfo-ops, _shared for `persona_key`/`decision_authority`/`permitted_ops`: no hit. `management_personas.decision_authority` is prose | NOT FOUND (enforcement) | n/a | GAP |
| 2: risk weighted sum | `v_program_risk` (above) | IMPLEMENTED LIVE | SQL-only | GAP |
| 3: half even, half by risk; +50% slots if risk up >10%/24h or quality index down 5 | north-star-managers.sql:333+ (`escalate`: base + (base+1)/2; `quality_trend` table, management-personas-3.sql:57) | IMPLEMENTED LIVE | SQL-only | GAP |
| 4: snapshot table written once per tick | `program_risk_now` (management-personas-2.sql:46-53), read by the plan view | IMPLEMENTED LIVE | SQL-only | GAP (not needed in SQLite engine) |
| 5: tiers primary metric, guard metric, then severity, age | `v_program_focus_candidates` tiers 0 primary, 1 guard, 2 critical, 3 high, 4 rest (header management-personas.sql) | IMPLEMENTED LIVE | SQL-only | GAP |
| 6: priority rows carry writer; delete only own, INSERT OR IGNORE | `scored_by` column; header states "INSERT OR IGNORE; delete only own rows" | IMPLEMENTED LIVE | SQL-only | GAP |
| 7: close metric-filed item when on target, fresh, aged, no failing contract | `v_persona_recovered_close` management-personas-2.sql:106; off switch ops_config `persona_actions` (:121) | IMPLEMENTED LIVE | SQL-only | GAP |
| 7: metric trigger re-files on later breach | `analytics_metric_triggers` (core table per boundary.json); filer `evaluateMetricTriggers` qnfo-fleet-control/worker.js:15908-16040 (issue title `METRIC-TRIGGER-<id>-<KEY>`, dedupe lookups at 15953 and 16001, recovery hold `triggerRecoveryHoldMin` 15898, `triggerRecoveryDue` 15902; evaluated hourly per the comment at 15735) | IMPLEMENTED LIVE | ENTANGLED (fleet-control kernel) | GAP |
| 8: lower priority of stale agent-filed item with no doer or session | `v_portfolio_critical_demote` management-personas-2.sql:136 (fleet-loop critical demoted to high; owner/session issues exempt) | IMPLEMENTED LIVE | SQL-only | GAP |
| 9: doer assignment: model proposes target+anchor, validate once-in-file | management-personas-4.sql (`v_parked_code_tasks` :36, steps `parked-agent-request`, `parked-return-log`); anchor validation is in qnfo-code-orchestrator planner (not line-verified) | PARTIAL | ENTANGLED (code-orchestrator) | GAP |
| 10: origination proposal, validate, file from merge-trusted source, daily cap | management-personas-6.sql (`roadmap_proposals` :38, `v_roadmap_originated` :57); steps `rm-research`, `rm-parse`, `rm-file` in `management-personas-c` (edited in north-star-managers.sql ~:352-380) | IMPLEMENTED LIVE | SQL-only; QNFO programs | GAP |
| 11: root-cause family issue, diagnosis, quiet close | management-personas-3.sql:45 `issue_recurrence_now`, :68 `v_root_cause_quiet`; issue title `ROOT-CAUSE-1:` (5 reopens in 7 days, top 10 families) | IMPLEMENTED LIVE | SQL-only | GAP |
| 12: queue score formula | `v_issue_queue_v2` tick-driver-roster.sql:81-83 (`ROUND(f.impact * f.probability * (f.capability_gain + f.reach_gain) * (1.0 / f.remediation_cost) * f.trust * (1 + f.direction), 3)`); trust from `trust_ledger` surface `code-loop`, action `merge`; `inferred_direction` | IMPLEMENTED LIVE | SQL-only; reach_gain categories are QNFO ('reach','research') | GAP |
| 13: config switch off keeps computing risk/allocation | ops_config `persona_actions` ('off' halts actions, management-personas-2.sql:121,134,148) and `north_star_focus` | IMPLEMENTED LIVE | SQL-only | GAP |
| 14: plane separation by requester identity at tool layer | Personal plane is separate workers (boundary.json class `personal`); no identity-based read denial located in qnfo-tools-mcp/deploy-guard | NOT FOUND (identity denial); worker separation only | ENTANGLED (QNFO personal plane) | GAP |

## Family B: plus loop (claims 15-23)

Sources: migrations/2026-10-29-plussing-1.sql, 2026-10-29-plus-1-products.sql, 2026-11-01-plussing-4.sql, -6.sql, 2026-11-02-plussing-7*.sql, 2026-11-05-plus-2-*.sql, 2026-11-05-plus-ledger-status.sql, docs/PLUSSING.md.

| Claim element | qnfo-workers location | Status | Entanglement | Portable equivalent / GAP |
|---|---|---|---|---|
| 15: product register separate from program register | `product_registry` plussing-1.sql:7-23 (rest_until, pluses_since_simplify, misses_in_row, plus_cadence_h, quality_measure, usage_metric/value); older `product_plus_registry` plus-1-products.sql:13 | IMPLEMENTED LIVE | SQL-only; rows are QNFO products | `engine.py` kind='plus' items per project: PARTIAL; no product register: GAP |
| 15: reserved share of change capacity not taken by repair | docs/PLUSSING.md (own queue, "plus budget"); plus-queue-priority.sql, plus-steps-own-task.sql separate task `management-personas-plus`. No explicit reserved-share column/formula found | PARTIAL | SQL-only | `engine.py` `plus_slots = max(1, round(slots*plus_share))`, `orgchart.py` validates `capacity.plus_share`, `tick.js` `check_plus_share`: portable is ahead of live |
| 15: select product by last-improvement, one in flight | `v_product_plus_due` plussing-1.sql:40 (redefined plussing-4.sql:37, plus-ledger-status.sql:56; `in_flight` of proposed/building, rest_until filter, `next_kind`) | IMPLEMENTED LIVE | SQL-only | `engine.py` `plus_share` (`open_plus` cap 6): PARTIAL |
| 15: model generates one additive change + prediction from evidence, no human request | steps `pl-research`, `pl-meta` in workflow `management-personas-plus` (north-star-managers.sql ~:360 adds NORTHSTAR/PREDICT lines) | IMPLEMENTED LIVE | SQL-only (model via cf_agent_requests, QNFO agents) | GAP |
| 15: dispatch through change path | `plus_ledger` (plussing-1.sql:24; `plus_ledger_v2` plus-ledger-status.sql:23 with status CHECK; issue_id, pr_url) | IMPLEMENTED LIVE | SQL-only | `engine.py` `PLUS-<id>` items via execute: PARTIAL |
| 15: baseline of outcome and guard at verified deploy | `plus_outcome_checks` plussing-4.sql:14-24 (baseline, baseline_at, guard_baseline); step `pl-outcome-baseline` :51 | IMPLEMENTED LIVE | SQL-only | GAP |
| 15: keep if material improvement and guard ok, else revert work item; missing/stale = not improved | steps `pl-outcome-review`, `pl-outcome-result` plussing-4.sql:52-53 (7 days); `outcome` defaults 'pending'. Revert-issue filing not separately verified | IMPLEMENTED LIVE (revert filing unverified) | SQL-only | GAP |
| 16: selection weighted by usage and friction | plus-2-usage-weighted-pick.sql (usage); no "friction" token found | PARTIAL (friction NOT FOUND) | SQL-only | GAP |
| 17: kept change seeds next change | plussing-6.sql:2,122 | IMPLEMENTED LIVE | SQL-only | GAP |
| 18: N consecutive non-kept sets rest time | plussing-6.sql:2 (three misses rest 7 days); `misses_in_row`, `rest_until` | IMPLEMENTED LIVE | SQL-only | GAP |
| 19: every Nth change a simplification | `pluses_since_simplify`, `next_kind` CASE WHEN >= 4 THEN 'simplify' (plussing-1.sql:19,44) | IMPLEMENTED LIVE | SQL-only | GAP |
| 20: missing usage: first change adds measurement | plus-2-5-usage-digest.sql (step `pl-usage`; failure mode `fm-product-usage-unmeasured`); explicit rule not located | PARTIAL | SQL-only | GAP |
| 21: reducing reserved share needs config record with expiry | no reserved share found | NOT FOUND | n/a | GAP |
| 22: digest record instead of per-change notification | `plus_digest` plus-2-5-usage-digest.sql:28 (weekly, step `pl-digest`) | IMPLEMENTED LIVE | SQL-only | GAP |
| 23: usage copied from analytics snapshot, null when stale/missing | plus-2-5-usage-digest.sql:41-43,70 (`usage_value` from `worker_usage_daily.requests_7d`) | IMPLEMENTED LIVE | SQL-only (Cloudflare analytics specific) | GAP |

Dashboard note: qnfo-fleet-dashboard/worker.js :18832-18859 (managers API) and :18928-19001 (plus API) only READ these tables; they are not the implementation.


# Families C, D, H (qnfo-workers HEAD 3eef0c5; old claim numbering)

Paths relative to qnfo-workers. Portable equivalents: PC = repo-clone/platform/core/ultrastable, SW = repo-clone/seed/worker, SA = repo-clone/seed/autonomy. "not line-verified" = file exists in repo-clone but I did not read the function.

## Family C: earned autonomy (claims 24-32)
| Claim element | qnfo-workers file:lines (identifiers) | Status | Entanglement | Portable equivalent |
|---|---|---|---|---|
| 24 prediction record (subject, operator, value, due) | migrations/2026-10-12-22-calibration-scorer.sql:38 `decision_predictions`; trigger `calibration_scorer_tick`; results in `decision_outcomes` (observed value, `matched`) | IMPLEMENTED LIVE | SQL-only (reads QNFO metric_registry) | PC engine.py STEP_ORDER "score_predictions"; SW src/tick.js (not line-verified) |
| 24 trust ledger by surface + action class, counts, score from prior | migrations/2026-10-12-20-kernel-registries.sql:73 `trust_ledger` (ok, fail, trust_score, ladder_position); refreshed in trigger `kernel_registries_tick` (:320, INSERT OR REPLACE INTO trust_ledger) | IMPLEMENTED LIVE | SQL-only; inputs are QNFO surfaces (canary, closes, decisions) | PC engine.py:21 `reliability()`, :68 trust_ledger rung lookup |
| 24 score to ladder rung + transition record | same file :214 view `v_trust_ledger_ext` (CASE observed/assisted/delegated/autonomous/self-directed/self-modifying/self-extending); :85 `trust_transitions`; :337 INSERT INTO trust_transitions | IMPLEMENTED LIVE | SQL-only | PC engine.py "accrue_trust" step (transition table not verified) |
| 24 execution path chosen by rung (low rung adds review) | no single mechanism mapping rung to path located; merge runner uses a static list `ops_config code_merge_trusted_sources` (migrations/2026-10-20-plan-trust-parity.sql) | PARTIAL (ledger and rungs live; rung-selected path NOT FOUND) | ENTANGLED (qnfo-fleet-control cmTrusted, qnfo-code-orchestrator) | PC engine.py:68 rung lookup (not line-verified) |
| 24 probe verifies result, counts updated | kernel-registries.sql:15-17 (comment), :325-345 tick body | IMPLEMENTED LIVE | SQL-only | PC "accrue_trust" |
| 25 score = (s+a)/(s+f+a+b) | kernel-registries.sql:220 `(ok + 5.0) / (ok + fail + 10.0)` | IMPLEMENTED LIVE | SQL-only | PC engine.py:22 `(successes + baseline*prior_weight)/(n + prior_weight)` |
| 26 a=b=5; bounds 0.3,0.5,0.6,0.7,0.8,0.9 | kernel-registries.sql:216-217 `t < 0.3 ... t < 0.9` | IMPLEMENTED LIVE | SQL-only | PC data/policy.json, SA policy.json (thresholds not line-checked) |
| 27 top rung self-modifies only via reviewed versioned change; no rung touches permission checks/secrets/gate rules | docs/AUTONOMOUS-OPERATION-DOCTRINE.md:272 ("Self-elevating trust"), :30; canonical deploy path; no code enforcing it found | PARTIAL (doctrine text + change path; no enforcement test) | doc | SA policy.json standing limits (unverified) |
| 28 build reversible form; route only irreversible+identity-bound as card with default/reason/probe | migrations/2026-10-08-autonomy-first.sql:84 trigger `human_actions_autonomy_first_ai` (reroutes non-identity-bound cards to agent_issues; resolution text :79); docs/AUTONOMY-DECISION-POLICY.md:24-25 tiers; migrations/2026-11-09-recall-loop.sql:31 `owner_asks` | IMPLEMENTED LIVE for routing; automatic construction of backup/canary/draft forms NOT FOUND as code | SQL-only | PC engine.py:93 gate_cards loop |
| 29 register of deferral signatures; exclude refusals; store matches; lower trust | kernel-registries.sql:44 `false_stop_register`, :53 `false_stop_phrases` (scope reply/user/disposition), :59 `false_stop_hits`, :199 `v_false_stop_candidates`, :205 disposition-phrase exclusion; migrations/2026-10-27-false-stop-reply-scope.sql (non-false-stops moved to `false_stop_hits_reclassified`); 2026-11-05-false-stop-disposition-2.sql | IMPLEMENTED LIVE for register/match/exclusion; PARTIAL for trust decrease (no per-hit trust_score decrement found; hits feed doctrine_proposals) | SQL-only | GAP |
| 30 question/options executed with default and revert path | 2026-10-08-autonomy-first.sql:84-100; `human_actions_default_adopt_ai` migrations/2026-10-12-34-default-adopt-prediction.sql:22 (default adopted, prediction written) | IMPLEMENTED LIVE for owner cards; conversion of a model's own question NOT FOUND | SQL-only | GAP |
| 31 DB trigger parses "<metric> <op> <number> within <N> h" | 2026-10-12-22-calibration-scorer.sql:67 `decision_predictions_parse` AFTER INSERT ON decision_log WHEN instr(predicted_outcome,' within ')>0; grammar :9-10 (h|days, also "issue <id> closed within") | IMPLEMENTED LIVE | SQL-only | GAP in seed/worker migrations (not found); PC parsing unverified |
| 32 trust decays toward prior when unexercised | no decay term; outcomes limited to a 30-day window (kernel-registries.sql:224-226), an approximation | PARTIAL | SQL-only | GAP |

## Family D: self-amending governance (claims 33-36)
| Claim element | qnfo-workers file:lines | Status | Entanglement | Portable |
|---|---|---|---|---|
| 33 signature register | kernel-registries.sql:44-65 `false_stop_register`, `false_stop_phrases` | IMPLEMENTED LIVE | SQL-only | GAP |
| 33 periodic matching of agent outputs and principal messages; store matches | `v_false_stop_candidates` (:199; owner_prompts branch :208-212); trigger `kernel_registries_tick` (:320) writes `false_stop_hits` | IMPLEMENTED LIVE | SQL-only (reads QNFO `owner_prompts`, `v_agent_replies`) | GAP |
| 33 threshold within window generates proposal | kernel-registries.sql ~:326-334 INSERT OR IGNORE INTO doctrine_proposals ... `HAVING COUNT(*) >= 3` over 7 days (proposal text is templated SQL, not model-generated) | PARTIAL (threshold and proposal live; model-backed generation NOT FOUND) | SQL-only | GAP |
| 33 replay proposal against stored ticks | `doctrine_proposals.metrics_improved` column (:96) only; scripts/policy_gate_replay.mjs replays a labelled corpus for the ops policy gate, not amendments | NOT IMPLEMENTED | n/a | GAP |
| 33 adopt by reviewed versioned change leaving protected limits; lineage | `doctrine_proposals.status/version`; migrations/2026-10-13-22-backoff-sla-doctrine-proposals.sql:15-28 (adopted by PR, version 'qnfo-ops 2.45.1 KERNEL-REPLY-2', `doctrine_lineage` kernel-8.2.1); kernel-registries.sql:150 view `lineage`; docs/DOCTRINE-KERNEL.md | PARTIAL (adoption is session/PR-driven; no automatic protected-set check) | SQL-only/doc | GAP |
| 34 red-team amendment with second model | `doctrine_proposals.red_team_result` column (:96); no running step found | NOT FOUND (column only) | n/a | GAP |
| 35 single friction match generates proposal | kernel-registries.sql friction INSERT, source 'friction:owner_prompts:'||reply_id | IMPLEMENTED LIVE | SQL-only | GAP |
| 36 refusal: correct own-text condition once, no reworded retry | policy text only (docs/AUTONOMOUS-OPERATION-DOCTRINE.md, CLAUDE.md); no code located | NOT FOUND as code | doc | GAP |

## Family H: autonomy policy as data (claims 53-56)
| Claim element | qnfo-workers file:lines | Status | Entanglement | Portable |
|---|---|---|---|---|
| 53 policy store: per-surface ceiling, per-action-class reversible and identity-bound flags | NOT FOUND as a table. Closest: docs/AUTONOMY-DECISION-POLICY.md:24-25 (T1/T2 prose); ops_config rows from migrations/2026-10-07-autonomy-uncapped.sql and 2026-10-08-autonomy-first.sql:35 | NOT IMPLEMENTED (prose and config flags only) | doc / SQL-only | repo-clone seed/autonomy/policy.json (keys: interrupt_gate, standing_limits, trust, ladder, surfaces) and platform/core/ultrastable/data/policy.json hold this; the GAP is in qnfo-workers only |
| 53 validator (irreversible and not identity-bound needs reversible path or denial) | no validator found; trigger `human_actions_autonomy_first_ai` (autonomy-first.sql:84) applies the rule at card time only | PARTIAL | SQL-only | repo-clone seed/bootstrap/bootstrap.py:452-476 `validate_policy` (checks start_rung vs ceiling at 462-464), `gated_actions` |
| 53 interrupt gate: card with default in effect, prepared, closing probe, auto-close | `human_actions`, `owner_asks` (recall-loop.sql:31), default-adopt trigger (2026-10-12-34:22), OWNER-STEPS-WATCH-1 probes | IMPLEMENTED LIVE | SQL-only | PC engine.py:93 `gate_cards` |
| 53 harness settings allow broadly, deny gated classes | .claude/settings.json:3-18 (`defaultMode acceptEdits`, deny: wrangler deploy/delete/secret put/delete/d1 delete, git push origin main, rm -rf) | IMPLEMENTED LIVE (one product, Claude Code) | CLEAN (data file) | GAP |
| 53 consistency test (gated action lacks deny rule fails) | scripts/claude-md-rules.test.mjs, agents-md-rules.test.mjs check instruction text only; no policy-to-deny-list test found | NOT FOUND in qnfo-workers | n/a | repo-clone seed/tests/test_seed.py:19 `test_gated_shell_reachable_actions_have_harness_deny` (compares policy `harness_deny` to .claude/settings.json permissions.deny) |
| 54 rung bounded by ceiling; changed only by reviewed policy change | no ceiling field; `v_trust_ledger_ext` runs to 'self-extending' unbounded | NOT IMPLEMENTED in qnfo-workers | n/a | repo-clone seed/worker/src/tick.js:131-132 (`ceiling_by_max_permission`, promote only inside ceiling and only by opening a PR item), platform/core engine.py:135-160 `accrue_trust` |
| 55 promotion/demotion rules (min count, reliability, severe failure, silent drop, bypass) | only score thresholds (kernel-registries.sql:216); metric `trust_ledger_min` needs >=10 outcomes (:279) | PARTIAL | SQL-only | repo-clone engine.py:150-155 (promote needs min_outcomes and min_reliability; demote on reliability_below or severe = hidden_failure/silent_drop) |
| 56 standing limits above any rung | docs/AUTONOMOUS-OPERATION-DOCTRINE.md, CLAUDE.md; not machine-enforced against a rung | PARTIAL (doc) | doc | SA policy.json (unverified) |

Counts (rows): IMPLEMENTED LIVE 15 (some with qualifiers), PARTIAL 10, NOT IMPLEMENTED 3, NOT FOUND 3 (rows with mixed status counted by their first status).


# Families E, F, G and dependents 41-45 (qnfo-workers HEAD 3eef0c5; old claim numbering)

Portable equivalents are in <owner-machine>\Dev\ultrastable\repo-clone (rc). rc was only grep-checked: no fence, kill switch or two-family review gate was found in rc platform/core store.py (claims table has claimed_at/heartbeat_at only) or engine.py.

## E: change path (claims 37-40)
| Claim element | qnfo-workers location | Status | Entanglement | Portable equivalent / GAP |
|---|---|---|---|---|
| 37 claim with token, expiry | qnfo-deploy-guard/worker.js:563-589 `acquireLease` (INSERT INTO deploy_locks token_hash, expires_at, expected_version; returns token); work_claims table migrations/2026-10-02-work-claims.sql:16-24 (expires_at default +2 hours) | IMPLEMENTED LIVE | CLEAN worker (class core); table SQL-only | rc platform/core store.py `claims` table (no token/fence); GAP: token, expected_version |
| 37 fence value greater than previous | migrations/2026-10-28-bp26-leases-killswitch.sql:10 `ALTER TABLE work_claims ADD COLUMN fence INTEGER`; worker.js:686-701 `liveFence`, stale-fence 409; sql header line 3 says every fresh claim takes the next fence number for its path. Allocation: worker.js:742-744 `SELECT COALESCE(MAX(fence), 0) + 1 AS f FROM work_claims WHERE path = ?1`, INSERT with `fence` | IMPLEMENTED LIVE (allocation and validation; enforcement inside the writing component NOT FOUND) | CLEAN | GAP |
| 37 refuse claim while unexpired claim of another agent | worker.js:625-645 `ledgerRows`, `holderId`, `claimTarget`; 409 with `held_by` at 587; `GET /work-locks` | IMPLEMENTED LIVE | CLEAN | rc claims table only; refusal semantics unverified |
| 37 component accepts write only with live token and current fence | worker.js:691-701 validate route compares `b.fence` to `liveFence`; enforcement inside the writing component NOT FOUND | PARTIAL | CLEAN | GAP |
| 37 two-family model review | scripts/review_gate.py:1-20 docstring (glm and llama families, never the author's family), `build_diff` 107, `classify` 141 | IMPLEMENTED LIVE (default mode `observe`; `hold` opt-in via REVIEW_GATE_MODE) | CLEAN (cites docs/ENSEMBLE-POLICY.md, pr-lane.yml) | GAP |
| 37 High finding kept only if evidence line verbatim in change | review_gate.py:78 (prompt: evidence copied exactly from an added line), `added_lines` 133, `vet` 267, `is_bound_template_claim` 259 | IMPLEMENTED LIVE | CLEAN | GAP |
| 37 refusal decided by code, not model | review_gate.py:9-18 comment starting `HOLD:`; pr-lane.yml merge step and qnfo-fleet-control stale-PR lane refuse; new push releases hold (line 18) | IMPLEMENTED LIVE (observe default means hold is not always active) | lightly ENTANGLED (fleet-control stale-PR lane) | GAP |
| 37 deploy under deploy lock | worker.js:85 `readLock`, 580-583 `deploy_locks`; qnfo-ops /ops/deploy; canonical-deploy.yml call site NOT FOUND by grep | PARTIAL | CLEAN (guard) | GAP |
| 37 declared probes; probe-triggered revert | scripts/deploy_probes.py:26-35, 218 `load_declaration`; scripts/canary_revert.py:7-42 (git revert of the push when a probe that passed before fails after); canonical-deploy.yml:174 baseline step before deploy | IMPLEMENTED LIVE | CLEAN (control-plane worker list inside canary_revert) | GAP |
| 38 reaper, orphaned count | scripts/claim_reaper.py:49 `main`, 45 `lock_key`; worker.js:645 LEASE-EXPIRY-SWEEP-1 (`outcome expired`, `orphaned_leases`) | IMPLEMENTED LIVE | CLEAN | GAP |
| 39 review continues on model outage | review_gate.py:10 (never blocks on its own failure); skip paths 620-640 (`MAX_RUNS_24H`, no credential) | IMPLEMENTED LIVE | CLEAN | GAP |
| 40 shared-resource probes excluded from revert | deploy_probes.py:26-28, 67-73 `TRANSIENT` regex (overload, timeout, 429/5xx inconclusive); canary_revert.py:40-42 | IMPLEMENTED LIVE | CLEAN | GAP |

## F: organization kit (claim 46)
| Claim element | Location | Status | Entanglement | Portable |
|---|---|---|---|---|
| Org-independent core, personas, charters, tick procedures as data | product/boundary.json (classes core/app/personal); tick procedures are `fleet_tasks` rows (e.g. migrations/2026-10-26-management-personas.sql); phases P1-P3 in boundary.json are `open` | PARTIAL | ENTANGLED (fleet-control, fleet-dashboard) | rc seed/ultrastable.json, seed/autonomy/policy.json, core-manifest/boundary.json |
| Tenant configuration (programs, products, executors, contact) | no tenant file; `program_charters`, `ops_config`; P3 open | NOT IMPLEMENTED as configuration | n/a | rc seed/IDEA.md, ultrastable.json |
| Boundary check fails when unclassified | scripts/product_boundary.mjs:4-5, 28-30 (`unclassified live worker`, `classified worker is not live`) | IMPLEMENTED LIVE | CLEAN | rc core-manifest/product_boundary.mjs |
| Perform claim 1 for another org without core change | P4 "second installation" open | NOT IMPLEMENTED (unproven) | n/a | GAP |

## G: bootstrapping from idea and seed (claims 47-52, 57)
| Element | Location | Status | Entanglement | Portable |
|---|---|---|---|---|
| Idea file as sole input; staged bootstrapper; credentials by presence | NOT FOUND in qnfo-workers | NOT FOUND | n/a | rc seed/bootstrap/bootstrap.py (`parse_idea` 63, `budget_from` 94, `main` 483) |
| Policy validator, gated actions | NOT FOUND in qnfo-workers | NOT FOUND | n/a | rc bootstrap.py `validate_policy` 452, `gated_actions` 476; seed/autonomy/policy.json |
| Provision DB and heartbeat worker; first tick | NOT FOUND in qnfo-workers | NOT FOUND | n/a | rc seed/worker/src/index.js, tick.js, wrangler.template.jsonc. First real cloud provisioning not yet run (CLAIM-STRATEGY) |
| 48 non-overwriting sync to agent products | tools-sync-agent-configs.py is outside qnfo-workers (<owner-machine>\Dev); no script in repo scripts/ located | NOT FOUND in repo | n/a | rc seed/AGENTS.md, CLAUDE.md pointers (claim 49) |
| 50 bootstrap success stored as prediction | NOT FOUND | NOT FOUND | n/a | rc seed/bootstrap/cases.json unverified |
| 51 stage failure becomes work item with owner, blocker, probe | NOT FOUND in qnfo-workers | NOT FOUND | n/a | rc bootstrap.py header lines 16-18 (stage never dies) |
| 57 shared protocol plus per-role files | root AGENTS.md | PARTIAL | CLEAN | rc seed/agents/ |

## Dependents 41-45
| Claim | Location | Status | Entanglement | Portable |
|---|---|---|---|---|
| 41 two schedulers, per-step record, missing slot detected | migrations/2026-10-12-21-tick-driver-roster.sql:42 `tick_runs`; 2026-10-08-18-heartbeat-detector.sql (fm-single-heartbeat over `fleet_tick`; producers cron:qnfo-code-orchestrator */10 and cron:qnfo-fleet-dashboard */15); 2026-10-19-fallback-heartbeat-proof.sql. Second heartbeat source: qnfo-fleet-control/worker.js:12355 `scheduled`, 12366-12374 (FLEET-TICK-SECOND-SOURCE-1: inserts `fleet_tick` rows with `source`). Expected-slot computation from cron expression with per-scheduler counts: NOT FOUND | PARTIAL | SQL-only, names QNFO workers | rc seed/worker/src/tick.js (single tick); GAP for dual |
| 42 item left active set without disposition is reopened | migrations/2026-10-08-17-retro-disposition.sql, 2026-10-12-24-register-dispositions.sql, 2026-10-18-issue-disposition-relapse-v2.sql, 2026-10-19-drop-disposition.sql; remediation_consumer.py:50 (REMEDIATION-REOPEN-1). Scanned-minus-buckets gap and silent-drop incident (claim 57 of the newer numbering): NOT FOUND by name | PARTIAL | SQL-only | GAP |
| 43 single owner queue, self-closing cards, reroute | migrations/2026-10-19-owner-queue-triggers-versioned.sql:59 `autonomy_reroute_queue`, 72-78 sets `human_actions.status = 'rerouted'`; 2026-11-09-recall-loop.sql:31 `owner_asks` | IMPLEMENTED LIVE | SQL-only | rc owner cards unverified |
| 44 kill switch and drill | migrations/2026-10-28-bp26-leases-killswitch.sql:12 `ops_config fleet_kill_switch` default off; worker.js:669 `killSwitchOn`, 701 503 `kill-switch`; scripts/cf_ops_actions.py:37-39 `kill-switch-drill` (max 10 min, appends `kill_switch_tests`, table at migrations/2026-10-26-bp26-audit-log.sql:67), reader list at 2051 | IMPLEMENTED LIVE | CLEAN worker; drill sits in a QNFO ops script | GAP |
| 45 model ladder, cheaper rung on cap, escalate on failed validation | qnfo-ai/worker.js:362-400 (`model_ladder_routes` ORDER BY cost ASC, `SPEND_CHEAP_MODEL`), 82-106 backoff then fallback leg, 33 SPEND-PRICE-FALLBACK-1. Escalate one rung on failed schema check: NOT FOUND | PARTIAL | ENTANGLED (router carries QNFO prompts and fleet cap steer) | GAP |


## Extract by refactor: monolithic entangled workers (function-level anchors)

Not copied to platform/cloudflare-reference. Line numbers are in qnfo-workers HEAD 3eef0c5.

| Worker | Anchor (name, lines) | Claim it carries | What must be separated |
|---|---|---|---|
| qnfo-fleet-control/worker.js (1.42 MB) | `evaluateMetricTriggers` 15908-16040, `metricTriggerValue` 16049, `triggerRecoveryHoldMin` 15898, `triggerRecoveryDue` 15902 | A claim 7 (metric trigger files, closes on recovery) | `METRIC-TRIGGER-<id>-` title grammar and QNFO metric names |
| same | `cmTrusted` 3617, `CM_TRUSTED_SOURCES` 3474 | A claim 10, C claim 24 (trusted-source merge admission) | QNFO issue sources and title prefixes hard-coded at 3474 |
| same | `loopWatch` 8710, `loopWatchEvaluate` 8666, `loopWatchFacts` 8697 | B/E (loop health, hidden failure) | QNFO loop names |
| same | `remediationContractsTick` 12823 | claim 57 (newer numbering) remediation contracts | outcome buckets and gap computation absent (see GAPS) |
| same | `scheduled` 12355 with FLEET-TICK-SECOND-SOURCE-1 12366-12374 | dependent 41 (two heartbeat producers) | `fleet_tick.source` names QNFO workers |
| same | `scheduled` 368, 1051, 2876 | tick entry points | each belongs to a different embedded module |
| qnfo-fleet-dashboard/worker.js (1.65 MB) | managers API 18832-18859, plus API 18928-19001 | A/B read side only | research pages and owner documents share the file; the manager logic is SQL, not here |
| qnfo-ai/worker.js | `model_ladder_routes` 362-400, backoff 82-106, `SPEND-PRICE-FALLBACK-1` 33 | dependent 45 (model ladder) | QNFO prompts, fleet cap steer |
| qnfo-code-orchestrator | planner anchor validation (A claim 9) | not line-verified | QNFO PLAN_TRUSTED prefixes |

## Newer-numbering crosswalk (ip/provisional)

| Newer independent | Old | Family or note |
|---|---|---|
| 1 | 1 | A management hierarchy (adds snapshot table and tool-layer denial inside claim 1) |
| 21 | 53 plus 24 | H/C autonomy policy store, trust ladder, gate card, harness deny list |
| 35 | 33 | D recognitions and false stops (change path executes the abandoned action) |
| 46 | 37 | E change path (token, fence, two disjoint model families, deploy lock, revert) |
| 57 | dependent 42 | failure-mode register, remediation outcome buckets, silent-drop incident: new family, status below |
| 70 | dependent 43 | owner cards, conditional rerouted claim, hand-over: new family |
| 82 | dependent 41 | dual scheduler slot counting: new family |
| 93 | dependent 45 | capability matrix model selection: new family |
| 105 | 47 | G bootstrapper from idea file |
| 116 | new | beliefs with falsifying probes plus policy lookup (belief_registry, spec allows) |
| 127 | new | idea file to business-function backlog, cross-family reviewer, deny-list scan |

Status for the new families against qnfo-workers (honest, brief): 57 PARTIAL (failure_modes table migrations/2026-10-08-13-failure-modes.sql:85, remediation contracts live, outcome-bucket gap and silent-drop incident NOT FOUND by name); 70 PARTIAL (human_actions rerouting trigger, `autonomy_reroute_queue`, `owner_asks` recall-loop.sql:31; the conditional open-to-rerouted claim not verified); 82 PARTIAL (fleet_tick producers, expected-slot counting NOT FOUND); 93 PARTIAL (`model_ladder_routes`; capability matrix `capability_ledger` migrations/2026-10-08-14-accounting.sql:99 exists, deterministic-handler-first and per-class cost-per-verified-outcome not verified); 116 PARTIAL (`belief_registry` migrations/2026-10-08-12-doctrine.sql:52 live; policy lookup allow/propose/deny not found); 127 NOT FOUND in qnfo-workers (lives only in rc seed/bootstrap).

## Totals (rows of the tables above, first status word of each row)

{'PARTIAL': 20, 'IMPLEMENTED LIVE': 57, 'NOT FOUND': 13, 'NOT IMPLEMENTED': 4}  (total 94 rows, all families incl. F, G and dependents 41-45)

Biggest gaps between claim text and live code: (1) G bootstrapping, the whole family exists only in rc seed/bootstrap; (2) D replay and red-team of amendments (columns exist, nothing writes them); (3) H policy store with ceilings plus the validator and the consistency test (prose and a deny list in qnfo-workers, a real implementation only in rc seed/); (4) A tool-layer denial of operations not enumerated in the persona record, and plane denial by identity (claims 1, 14); (5) C rung-selected execution path and trust decay (claims 24, 32); (6) E fence enforcement inside the writing component; (7) F tenant configuration and second-installation proof (boundary.json phases P3, P4 open). Where rc is AHEAD of live: reserved plus share (engine.py `plus_slots`, orgchart.py, tick.js `check_plus_share`), ladder ceiling and promote/demote rules, `amend`.
