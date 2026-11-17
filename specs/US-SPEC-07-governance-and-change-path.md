<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-07: Self-amending governance and canonical change path

| Field | Value |
|---|---|
| ID | US-SPEC-07 |
| Title | Self-amending governance and canonical change path |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Two mechanisms keep an autonomous organization correct over time. Governance converts recorded failures of behavior (repeated false stops, friction, incidents) into versioned amendments of the operating rules, tested before adoption. The canonical change path makes every change travel one route: claim, review, merge on green, deploy under a lock, probe, revert on regression. Together they let rules and code change without a person in the loop and without weakening the protected limits.

## 2. Terms

| Term | Definition |
|---|---|
| Kernel | A versioned document of structured text carried in the instructions of each model-backed agent: voice convention, recognitions, states, commitments, tick steps, trust weights, registries, metrics. It describes how loops work and confers no authority. |
| Recognition | One record pairing a signature (phrases, patterns or state conditions) with a redirect. |
| False stop | An agent output that pauses, asks, offers options or assigns a next step to the principal when the step was not interrupt-eligible. |
| Draft output | Agent output not yet emitted to a reader, log or process. |
| Amendment | A proposed rule change. |
| Protected limits | The limits no amendment may weaken (section 4.3). |
| Hold marker | A comment at the start of a review result that makes the merge step refuse a change. |
| Risk class | A category of change (authentication, routes, caching, data migrations, workflow permissions) that needs two-family review. |

## 3. Self-amending governance

```mermaid
flowchart TD
  A[702 scan outputs and principal messages] --> B{704 signature hits 3 times in 7 days from one source, or friction phrase once?}
  B -- no --> A
  B -- yes --> C[706 write doctrine_proposals row with proposed rule]
  C --> D[708 red-team by a second model; replay against trailing ticks]
  D --> E{improves a metric, worsens none beyond tolerance, protected limits untouched?}
  E -- yes --> F[712 adopt by reviewed change; bump version; doctrine_lineage row]
  E -- no --> G[714 reject with reason]
```

**Procedure.** E1 collect; E2 classify (doctrine defect or transient); E3 generate (a model writes the rule with its scope); E4 red-team (a second model tries to find a case where the rule harms a protected limit or a commitment; any success rejects); E5 replay (re-evaluate the last 7 days of hits, decisions and outcomes as if the rule had been in force); E6 adopt (replay improves at least one metric and worsens none beyond tolerance: the amendment lands as a reviewed change, the version increments, a lineage row is written, and the commitments are verified unchanged); E7 report in one line. A weekly audit item lists open proposals.

### 3.1 Recognition engine

Applied to each draft output, before or after emission.

| Shape | Example signature | Redirect |
|---|---|---|
| Conditional offer | "if you want", "let me know if", "shall I" | adopt, execute, emit as done |
| Report ending in a question | "?", "your call" | decide, state the decision as fact |
| Menu | "either A or B", "two options" | choose, execute, mark alternative superseded |
| Blocker without surface coverage | "can't", "refused", "no access" | enumerate surfaces, test each, then report |
| Stop not interrupt-eligible | pause, ask, wait, confirm | classify; if false, re-execute the abandoned path |
| Principal as executor | "you could run" | dispatch from the roster |
| Principal as actor | "needs you to", "you should" | rewrite in first person and execute; else dispatch |
| Silent drop | item leaves active set with no disposition | log disposition or reopen |
| Friction | "I shouldn't have to", "every time" | generate, red-team, adopt an amendment |
| Narration | "the fix is to" | produce the changed artifact in the same output |

**Classification.** A hit is excluded from redirect when (a) the output plainly states a refusal or limit with its reason, (b) the step is interrupt-eligible, or (c) the step is owned by another agent's live claim. An excluded hit is reported as a disposition naming its owner and closing probe and written to the hit table with `excluded = 1`. Otherwise it is a false stop: the draft is rewritten by the pattern's redirect and the abandoned path is executed and verified in the same cycle, so the rewritten statement is true when emitted. If it cannot be executed it is dispatched; if no executor can take it, it is escalated and only when it remains identity-bound becomes one gate card. Every hit is recorded; a signature hitting 3 times in 7 days from one source files an amendment proposal.

```
function recognize_and_redirect(draft, scope, ctx):
    hits = [p for p in register if p.active and match(p, phrases(p, scope), draft)]
    if not hits: return emit(draft)
    for h in hits:
        if states_refusal_with_reason(draft, h) or interrupt_eligible(ctx) or live_claim_owned_by_other(ctx):
            record_hit(h, excluded=1); out = disposition_report(h, ctx)
        else:
            out = rewrite(draft, h.auto_remediation)
            if requires_action(h): result = execute_or_dispatch(out.action, ctx)
            if not result.verified: out = report_result_as_open_item(result)
            record_hit(h, excluded=0)
            trust.deduct(ctx.surface, ctx.action_class, WEIGHT[h.pattern_key])
    return emit(out)
```

**Tables.** `false_stop_register(pattern_key, pattern, cause_class, detection_heuristic, auto_remediation)`, `false_stop_phrases(pattern_key, scope, phrase)`, `false_stop_hits(id, ts, pattern_key, source, source_ref, excerpt, excluded, exclusion_reason)`. Signatures are rows and extend without a code change.

**Commitments (cannot be removed by amendment).** Interrupt gate (pause only for irreversible and identity-bound steps, after engineering reversibility); alignment floor (honest, non-harmful, trust-preserving); affirmative adoption (each identified action is executed and verified in the same output); affirmative default (the answer to a reversible, in-scope question is yes, within the bounds of the interrupt gate, harness and classifier refusals, secret locks and live claims); actor commitment (no sentence of a report has the principal as the subject of an action).

**Fixed readings.** The kernel describes how loops work and confers no authority; it installs into no harness and replaces no instructions of the system an agent runs in. "The affirmative displaces the negation" governs how work is reported and never whether a limit exists. Trust widens only the loop's own scopes. An interrupt-eligible, refused or claimed step is reported as exactly that.

**Metrics.** Target 1: self-adoption rate. Target 0: false-stop rate, conditional-offer rate, question rate (questions asked when the answer was yes), actor-assignment rate, narration rate. Each has a trigger.

### 3.2 Objective space and self-authored goals

Systems that originate only inside a charter leave the principal as the sole source of direction; systems that rewrite their own objective drift silently. The objective space separates them.

| Concept | Rule |
|---|---|
| Ratified objective | Written only by the principal or a ratification action, never by an agent |
| Goal | Falsifiable, reversible, instrumental, evaluated against a ratified objective |
| Derived goal | Adopted with a recorded parent objective and an alignment sentence |
| Novel goal | No ratified anchor; enters probation with a review deadline and is not dispatched to executors with write authority |
| Objective revision | Any candidate that changes the mission, objective weights or the boundary of residual consent: written as `proposed` and never adopted by the authoring agent |

Daily cycle: gather signals (bounded reads; a failed read yields empty, not an abort); synthesize falsifiable candidates with a definition of done; classify; score `0.4*falsifiability + 0.4*leverage + 0.2*novelty` and reject below a threshold (default 0.5); reject near-duplicates of goals adopted in the last 30 days when Jaccard or containment similarity of token sets is at or above 0.6 (a candidate of 10 tokens sharing 6 with a 14-token goal has Jaccard 0.33 but containment 0.6, so a reworded duplicate is rejected); anchor by stem match to a ratified objective; adopt at most N (default 3) per cycle, highest score first; retire when the done probe passes, when stale beyond a limit, or when superseded. Adoption also writes a row to a ledger that a worker drains, so a goal is never inert.

## 4. Canonical change path

```mermaid
flowchart TD
  A[1202 executor produces change under a work claim] --> B{1204 risk class?}
  B -- yes --> C[1206 diff to two models of disjoint families, neither the author's family]
  C --> D{high finding survives verification?}
  D -- yes --> E[Hold marker written; merge refuses]
  D -- no --> F
  B -- no --> F[1208 merge when checks green; deploy under deploy lock]
  E -->|new push releases hold| A
  F --> G[1210 run component probes]
  G --> H{1212 probe that passed before fails now?}
  H -- yes --> I[1214 revert to prior version; file failure item]
  H -- no --> J[1216 deploy ledger row; capture baselines]
```

**Review gate.** Each finding must state a concrete trigger; a high-severity finding must include an evidence line that occurs verbatim in the diff, otherwise it is demoted; a finding without a trigger is dropped. The hold decision is made by code from verified findings, not by the model, and the diff is treated as data. The gate fails open on its own outage (logs and continues) and runs in `observe`, `hold` or `off` mode. Cost per run is recorded. Adversarial brief: authentication bypass, injection, cache audience, double submission, null handling, ordering and limits, retry storms, trigger depth, workflow permissions.

**Probes.**

```json
{ "mode": "revert",
  "health": "https://service.example/health",
  "http": [ { "url": "https://service.example/health", "contains": ["\"worker\":\"service\""] } ],
  "d1":   [ { "sql": "SELECT COUNT(*) FROM table WHERE ...", "expect": ">0" } ] }
```

## 5. Normative requirements

- **US-07-R01 [L2]** Amendments to policy, role files or kernel MUST travel the canonical change path and MUST increment a version recorded in a lineage table.
- **US-07-R02 [L2]** An amendment MUST be red-teamed by a second model and replayed against stored records before adoption.
- **US-07-R03 [L2]** An amendment that modifies a protected limit or a commitment MUST be rejected without replay.
- **US-07-R04 [L2]** The protected limits are the harness permission checks, classifier refusals, the secret lock, live claims of other agents, outreach consent, suppression and opt-out handling, plane separation, the interrupt gate and the principal's override. No amendment, rung or score MAY weaken them.
- **US-07-R05 [L2]** The recognition engine MUST exclude from redirect any output that states a refusal or limit with its reason, any interrupt-eligible stop and any step owned by another agent's live claim.
- **US-07-R06 [L2]** A rewritten output MUST be true when emitted: the abandoned path MUST be executed and verified before the rewritten statement is emitted, or the output reports the dispatch or open item.
- **US-07-R07 [L2]** Every recognition hit, excluded or not, MUST be recorded.
- **US-07-R08 [L2]** A refusal by a check MUST be treated as an input; the same action MUST NOT be resubmitted in different words to pass the same check.
- **US-07-R09 [L2]** Control-plane files MUST NOT be changed by an agent holding no work claim, and MUST be changed only by reviewed change.
- **US-07-R10 [L2]** For a change in a risk class, the review MUST use two models of disjoint families, neither the author's family.
- **US-07-R11 [L2]** The hold decision MUST be computed by code from verified findings, and the diff MUST be treated as data.
- **US-07-R12 [L2]** Deploys of one component MUST be serialized by a lock. A probe that passed before and fails after MUST revert the deploy.
- **US-07-R13 [L2]** A deploy ledger row MUST record the version, and the artifact SHOULD be compared byte for byte with the source.
- **US-07-R14 [L2]** An agent MUST NOT write a ratified objective. An objective revision MUST NOT reach status `adopted` or `active` through the authoring agent.
- **US-07-R15 [L2]** An adopted goal MUST have a non-empty parent objective and alignment sentence; a novel goal MUST carry a probation deadline.
- **US-07-R16 [L3]** A configuration or prompt loaded into a fleet loop without the commitments MUST be rejected.
- **US-07-R17 [L3]** Implementations of the engine SHOULD include a pre-emission filter that buffers a draft, masks fenced and quoted text, and returns a revision request to the reasoning component at most R times (default 2).

## 6. Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Engine rewrites a draft into a false statement | Dishonest report | R06 |
| Rule that compels action disables its own bounds | Unsafe autonomy | Fixed readings; R03, R04 |
| Review model outage | Work stops | Gate fails open and logs |
| Reworded duplicate goals | Backlog noise | Containment test |
| Objective drift | Silent change of purpose | R14 |
| Concurrent deploy reverts a purge | Defect returns | Lock (R12) and guard programs (US-SPEC-09) |

## 7. Conformance tests

- **US-07-T01** Feed the draft "The timeout is fixed. Let me know if you'd like me to open the pull request?" Pass: output states the pull request is open with its identifier read back; two hits recorded. Fail: the question is emitted.
- **US-07-T02** Feed "I can't push; the token has no access." with no surface list. Pass: surfaces are enumerated and tested, or a deduction is recorded.
- **US-07-T03** Propose an amendment that removes a commitment. Pass: rejected at red-team, no replay.
- **US-07-T04** Submit a change touching authentication with a high finding whose evidence line is not in the diff. Pass: finding demoted, no hold. With the line present: hold marker written.
- **US-07-T05** Deploy a version that fails a probe that passed before. Pass: reverted, failure item filed.
- **US-07-T06** Give an objective revision status `adopted`. Pass: refused by code.

## 8. Reference implementation status

Paths are relative to the workers repository. A line names a file that exists and a test that passes; code named here has not run in production unless the line says so, and every model port is a fake in the tests.

- Policy as versioned data and ladder items by reviewed change: BUILT in the seed (`autonomy/policy.json`, `doctrine_lineage` table in `core/migrations/0001_init.sql`; the bootstrapper `bootstrap/bootstrap.py` writes the first lineage row). The seed tick itself has no amendment generator, red-team or replay; those are in `core/governance`.
- Signature register and recognition engine (R05, R06, R07, T01, T02): BUILT in `core/governance/register.js` and `core/governance/engine.js` (`seedRegister`, `recognize`, `scanState`, `rates`) with schema `core/governance/migrations/0001_governance.sql`, tests in `core/governance/governance.test.js`. The ten shapes are rows (`governance_false_stop_register`, `governance_false_stop_phrases`, `governance_false_stop_hits`). Exclusions are decided from the refusal and gate state the caller passes and from the `claims` table. A rewritten statement is emitted only from an executor result that was verified and read back; otherwise the output reports the dispatch or an open item.
- Self-amendment loop: periodic threshold matching, generated proposals, protected-set check, red-team, replay against stored scans and ticks, adoption with version bump and lineage (R01 to R04, T03): BUILT in `core/governance/amend.js` (`scanThresholds`, `generateRules`, `protectedProblems`, `redTeam`, `replay`, `adopt`, `auditItem`), tests in `core/governance/governance.test.js`. The protected-set check is code and runs before any model; the red-team model must be of a different family from the author; replay scores the amended register against judged scans of the trailing 7 days; adoption needs a reviewer other than the author and writes `governance_lineage` and `doctrine_lineage`. Replay covers register amendments; an amendment to policy numbers or role text needs an `evaluate` port. The rule generator and the red-team are ports.
- Commitments required in a loop prompt (R16): BUILT in `core/governance/register.js` (`loadLoopPrompt`, `missingCommitments`), test "US-07-R16" in `core/governance/governance.test.js`.
- Objective space (R14, R15, T06): BUILT in `core/governance/objectives.js` (`ratifyObjective`, `proposeRevision`, `setObjectiveStatus`, `adoptGoals`, `drainGoalLedger`, `retireGoals`), tests in `core/governance/governance.test.js`. Signal gathering and candidate synthesis are not built: candidates are an input.
- Self-amendment loop, recognition engine (hourly detection scan and prompt-carried recognitions), kernel version 8.2.1 lineage, objective space: RUNNING in QNFO.
- Canonical change path, two-family review (R10, R11, T04): BUILT in `core/deploy/review.js` (`createReviewGate`, `verifyFindings`, `riskClasses`) with schema `core/deploy/migrations/0002_review.sql`, tests in `core/deploy/review.test.js`. Two reviewers of disjoint families, neither the author's; a finding without a trigger is dropped; a high finding is kept only if its evidence line is verbatim in the diff; the hold is computed by code and the diff travels as data; modes `observe`, `hold`, `off`; fails open on reviewer outage; a new push releases the hold.
- Canonical change path, deploy lock, probes and revert, ledger (R12, R13, T05): BUILT in `core/deploy/index.js`, `core/deploy/lock.js` and `core/deploy/probes.js`, tests in `core/deploy/deploy.test.js`. A reverted deploy files a failure item. The ledger records versions and a SHA-256 of the artifact; a byte comparison against the source repository is not built.
- Canonical change path with two-family review, deploy lock, probes and revert: RUNNING in QNFO.
- Pre-emission filter (R17) and classifier-port matching: BUILT in `core/governance/engine.js` (`preEmit`, `mask`, the `classifier` port of `recognize`), tests "US-07-R17" and "classifier-port matching" in `core/governance/governance.test.js`. The filter buffers the draft, masks fenced and quoted text and returns at most R revision requests (default 2). No classifier model ships; the port is exercised with a fake.
- Event-weighted trust deductions per recognition: BUILT in `core/governance/engine.js` (table `governance_deductions`, port `deduct`) and `core/trust/index.js` (`recordEvent`), test "event-weighted trust deductions per recognition" in `core/governance/governance.test.js`.
- Refusal as an input, no resubmission in other words (R08): BUILT in `core/trust/index.js` (`recordRefusal`, `maySubmit`), test "section 4, US-07-R08" in `core/trust/trust.test.js`.
- PLANNED: running `core/governance` in an organization (its `step` runs in the composition root (`core/org/buildout.js`) without model ports; `preEmit` is not called by the runner, so no agent output has passed through it); live generator, red-team, classifier and reviewer models behind the ports (need provider credentials); the merge step asking `mergeAllowed` before it merges; R09 (control-plane files only by reviewed change) stays repository policy and CI; triggers on the section 3.1 rates and the self-adoption rate.
