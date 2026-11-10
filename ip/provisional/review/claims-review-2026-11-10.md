# Independent QA Review: CLAIM-STYLE SUMMARIES (claims 1-157)

File reviewed: /home/claude/ultrastable/ip/provisional/provisional-specification.md, lines 1596-1949 (spec not edited). Paragraph cites are the spec's own [nnnn] numbers; section numbers are the "## N." headings. Draft for attorney review; not legal advice. Claims are non-binding in a provisional, so the findings matter mainly for (a) the claims a nonprovisional will carry and (b) whether the provisional supports them under 35 USC 112(a) for the priority claim.

## 0. Headline findings

1. Claims 58 and 59 ("method of any of claims 1 to 57") sweep in system claims 53-56 (wrong statutory class) and multiple-dependent claims 41-45 and 57 (a multiple dependent claim cannot depend on another multiple dependent claim; 37 CFR 1.75(c), 35 USC 112(e)). They also omit claims 60-157.
2. Claim 74's priority rule is logically impossible as written: "when a time slot has no record, opening a work item ... a lower second priority when a record exists from only one of them." A slot with a record from one scheduler is not a slot with "no record". The spec itself is inconsistent here: [0164] step 1824 alerts on zero records, but [0165] says a slot with one record "no alert fires".
3. Claim 114 and its dependent 115 conflict: 114 says "closing the finding only when the claim state is observed ... and otherwise setting the finding to pending"; 115 says the finding is closed when the claim state is "inferred" (spec [0310] step 3 does allow an inferred close with a label).
4. Claim 47 requires "the sole human input" and "no step executes on a computer of the human". Neither phrase has support. The same claim has the bootstrapper detect credentials and open gate cards for "steps only the human can take", and [0358] shows the bootstrapper running in CI or locally.
5. Many claim elements rest only on text the spec itself labels "prophetic (not yet built)": event-weighted trust and decay ([0131]; claims 32, 67, 68), per-step service-level table and rejecting one-path process definitions ([0150]; claim 72), shadow sampling and demotion ([0278]; claim 107(e)-(f)), sections 45-46 tenant isolation and adapters ([0362], [0365], [0370]; claims 138-142), binned calibration ([0275]; claim 111), code/ops classifier ([0285]; claim 112), emitter-set detector ([0335]; claim 123), retry bound ([0324]; claim 120). Prophetic text can support a claim in a provisional only if it teaches how to make and use; several of these are one-line statements.
6. Heavy duplicate families (section 6.3).

---

## 1. Antecedent basis and claim-structure errors

### 1.1 Dependency and statutory-class errors

| Claim | Problem (quoted) | Fix |
|---|---|---|
| 58, 59 | "the method of any of claims 1 to 57" includes 53-56 ("The system of claim 53/54/55/56"), which are system claims, and multi-dependent 41-45, 57 | Limit to "any of claims 1-52" and break out per family; delete references to multiple-dependent claims (1.75(c)) |
| 58, 59 | Range stops at 57; claims 60-157 (including 60, 72, 74, 88, 102, 114, 127, 143) have no system/CRM counterpart | Add per-family system/CRM claims or a single "method of any of claims 60-157" scoped to method claims only |
| 57 | "The method of any of claims 47 to 52" sits after system claims 53-56 and is itself multiple dependent, then is swept into 58/59 | Move next to 52; single-dependent on 47 |
| 41-45 | "The method of any of claims 1, 15, 24, 33 or 37" - multiple dependent. Claims 58/59 do not cite them in a way that avoids the problem, but 58/59 cite the range 1-57 | Redraft as separate dependents per parent, or accept fee surcharge and fix 58/59 |
| 145 | "The method of claim 143" - recites "a machine loop token ... file and clear queue entries ... approve a decision or hand work back to the fleet". Claim 143 (email-code login) has no queue, decision or fleet | Re-parent to claim 144 (system); change "method" to "system" |
| 146, 147, 148, 149 | Depend on method 143 but recite command registry, voice transcription, "reverting an agent-authored pull request", masked address. 146-148 are only loosely related to the login flow | Re-parent 146-148 to a new independent "owner console command" claim (spec [0391]-[0394]); keep 149 on 143 |
| 150, 151 | "The system of claim 144, wherein a tap on an option of a stored question..." / "a view lists answered questions" - unrelated to owner cards of 144 (they come from [0400], a second queue) | Create separate independent claim for prompted-recall questions ([0400]) |
| 101 | "The medium of claim 100 ... filter every candidate suggestion for a surface on a server by a deny list" - unrelated to experiments (spec [0234], suggestion engine) | Separate independent claim |
| 106 | "refusing to install a cost guard on a path until a resolved upstream model ..." - unrelated to capability-matrix routing of 102 | Separate or delete |
| 112, 113 | Depend on claim 107 (model admission) but recite request classification (code/ops/chat) and executor adapters/trust keyed by executor ([0283], [0287]-[0288]) | Re-parent to new independent claims on code-only mode and per-executor trust |
| 119 | Depends on audit-and-act 114 but recites "repository registry"/"deployed registry" traffic share ([0307]) | Re-parent or make independent |
| 138-142 | Depend on method 127 but 140-142 (adapter ports, schedule port, deploy port) belong to sections 45-46 (prophetic) | Group as own family |
| 135 | "claim identifiers named in the boundary manifest" - 134's manifest lists "core scripts, core workflows and core tables"; no claim identifiers recited | Add "the manifest further naming identifiers of product claims" in 134 or 135 |

### 1.2 "the X" without a prior "a X"

- Claim 27: "the agent processes modify their own tick procedures" - parent 24 recites only "an agent process" (singular). Same for 29 ("outputs of the agent processes"), 30, 43 ("rerouted to the agent processes" - parents 15, 37 recite only singular), 65 (parent 60: "an agent process"), 41.
- Claim 41: "the scheduled ticks are produced by at least two independent schedulers" - claims 15, 24, 33, 37 recite no "scheduled ticks". Only claim 1 does. Claim 42 "on each tick" is acceptable as a fresh introduction but also has no tie to 15/24/33/37.
- Claim 39: "the review continues" - claim 37 recites no review; only "submitting the change to models". Also "an outage of a review model" introduces the term after the fact.
- Claim 47: "performing ... the method of claim 1 for the programs and products of the charter" - "the programs and products" lack basis (47 recites a charter and "a manager agent role for each stated outcome", not programs or products; claim 1 recites "a program" but not products).
- Claim 48: "the agent instruction file" - 47 recites "agent instruction files" (plural, no singular). "the instruction location" is introduced inside the same clause as "an instruction location"? It reads "the instruction location of each of a plurality of agent products" - no prior "an instruction location".
- Claim 60: "or when the step is held by a live claim" - "the step" has no basis (only "a stop" and "the draft output"). "executing and verifying the abandoned action" - "the abandoned action" has no basis. "a false stop" is defined only by negation (any match not "excluded").
- Claim 65: "the recognitions are further carried in instructions of each of a plurality of model-backed agent processes" and "the agent processes" - 60 recites "an agent process".
- Claim 71: "wherein the interrupt gate pauses only" - claim 67 mentions "an interrupt gate" only inside a negative list ("permit no position on the ladder to change a permission check, a secret store, an interrupt gate or an alignment floor"). No positive recitation of the gate.
- Claim 73: "pulling every open agent-owned row having a due date beyond a first limit from its open date to the first limit" - "its open date" has no basis in 72 (72 has no rows, due dates or open dates); "a first limit" never defined as a number. 72 also uses "process" with no antecedent ("each stage of each process", "a process definition" vs "single definition of done" per process).
- Claim 91: "withholding dispatch to executors" - 88 recites no executors (only "a scheduled consumer").
- Claim 92: "the authoring is executed under an authentication check" - 88 never recites "authoring"; it recites "generating ... candidate goal statements".
- Claim 144: "the fleet" / "a fleet loop" never introduced.
- Claim 118: "the claim states code-only, staged, inferred and observed" - 114 recites "a claim state ... selected from"; plural "claim states" has no basis. "a claim lacking a deciding query or a null expectation" - "claim" is overloaded in this family (the finding's "claim", the "claim state", and the work claim of claim 37).
### 1.3 Dependent claims whose parent lacks the element they refine

- Claim 55: refines "a rung of a trust ladder" - established in 54. OK. But 53 itself recites no ladder, and 56 ("take precedence over any rung") depends on 53, which has no rung. Re-parent 56 to 54.
- Claim 71: see above (no positive "interrupt gate" in 67).
- Claim 83: "the activity table" has no basis in 81. Claim 84: "executor self-report" - 81 recites no executor. Claim 96: "active set" - 95 recites states but no active set. Claim 116: "at least three independently derived rosters" - 114 recites no rosters.
- Claim 150: "a trigger that writes only a table without triggers" - unintelligible as drafted (spec [0400]: trigger writes `product_profile` by INSERT OR REPLACE; the clause should say the target table has no triggers of its own, to avoid cascades).
### 1.4 Internal inconsistency

- Claim 26: "the rungs are bounded at trust scores of about 0.3, 0.5, 0.6, 0.7, 0.8 and 0.9" - six boundaries; claim 24 mentions "one rung of an ordered autonomy ladder" without count. Matches [0057] (seven rungs). "about" is relative (see 2.1).
- Claim 74 and 114: see section 0.
- Claim 72: "rejecting a process definition having exactly one path" vs spec [0147] "a step with exactly one path is a gap to close" (no rejection mechanism disclosed).
- Claim 5 vs spec [0041]: claim says "work items associated with a primary metric first, ... guard metric second, and remaining work items by severity and then by age"; spec tiers are "tier 2, critical; tier 3, high; tier 4, other; then by priority and age". "Severity" is not the spec's term.
- Claim 8 vs [0043(d)]: claim says "lowering the priority of a work item that was filed by an agent process more than a period earlier"; spec lowers only a critical item filed by a machine loop >24 h earlier that is "not filed by a metric trigger and not a primary- or guard-metric focus item". Claim is broader than the disclosed rule; support is by generalization.
- Claim 89: "similarity threshold is at least 0.5" vs [0199]: threshold 0.6 (and 0.5 only for score threshold). 0.5 is unsupported for similarity; [0207] alternative uses 0.75.

---

## 2. 35 USC 112(b) indefiniteness risks

### 2.1 Relative and approximate terms
- Claim 26 "about 0.3, 0.5, ..." - no bound on "about". Delete or give a range ("within 0.02").
- Claim 53 "harness settings ... that allow actions broadly" - "broadly" is subjective. Recite "allow all action classes not denied".
- Claim 2 "high-priority work items" - "high" relative; spec [0037] uses a priority label. Use "work items having a priority label of high or critical".
- Claim 37 "high-severity finding" - tie to a severity scale (spec [0068] "high" label).
- Claim 15 "materiality threshold", "tolerance", "stale" (claims 15, 23, 88): "stale" undefined; define by age relative to a window. Claim 88 "stale limit" is a quantity, but "stale" is not defined.
- Claim 45, 102(e), 106: "cheaper rung" / "lowest cost" - cost measure unspecified (price per token? cost class?). Spec [0254] defines rung cost; claim 102(d) should say "lowest recorded cost".
- Claim 100 "significance level" and "futility bound" - unspecified statistic ([0241], [0242]).
- Claim 3 "increased number of slots", "a quality index" - undefined metric; spec [0037] defines it.
- Claim 18 "a set number", claim 19 "every Nth", claim 41 "at least two independent schedulers" ("independent" is defined at [0164] as sharing no process and no next-fire table; claim 74 does recite that, claim 41 does not).
- Claim 63 "a distinct path to the same outcome"; claim 117 "distinct path" - bounded by "surface" definition; acceptable if "surface" is defined (see 2.2).
- Claim 60 "a signature of a shape of agent output" - "shape" is vague; "false stop" defined negatively.
- Claim 112 "ambiguous requests" - determined by a "deterministic function"? The claim leaves the ambiguity test open.
- Claim 144 "a reason", "a default in effect" ("in effect" modifies "default"; unclear what makes it "in effect").
- Claim 81 "dimension scores ... a confidence" - confidence undefined.

### 2.2 Coined or term-of-art-less terms that need claim-level definitions
"doer line" (claims 8, 9, 10; spec [0043(e)] "first lines of the item"), "plus"/"additive change" (15), "surface" and "action class" (24, 53, 60, 67), "rung" (24), "gate card"/"card" (28, 43, 53, 127, 144), "persona record" (1), "tick" (1, 41, 67, 127), "false stop" (60), "recognition" (60), "silent drop" (67; claim 42 says "left an active set without a recorded disposition" - good), "alignment floor" (67; [0134] IC-ALIGN-001), "kit backlog" (127), "watchmaker index" (153; [0384] defines), "capstone record" (116), "ghosts / islands / sinks / sources" (81; graph theory terms defined in claim, ok), "entangled note" (137), "map/bridge/territory rung" (118), "wheel". Without definitions in the claims, an examiner will read these as indefinite or as nonce labels.

### 2.3 Other
- Claims 28, 105: "and"/"or" ambiguity in lists ("taking and verifying a backup"; "at least one of tool-call validity, schema conformance and context size"); use Markush form.
- Claim 118 "demoted one rung": rung of which scale.
- Claim 127: 441 words, 12 clauses, "guard" used in two senses.
- Negative limitations in 47 ("no step executes on a computer of the human") and 53 ("stops only") need support (section 5).
- Claims 134 and 144 embed UI events ("when the sentence is displayed", "on a tap") in processor claims; recite receipt of a selection indication.

---

## 3. 35 USC 112(f) risks

The claims avoid "module", "unit", "engine", "means", "configured to" as the operative phrase (grep: none of "module", "engine", "means"; "unit" appears only as "currency unit" in claim 154). Exposure comes from functional nouns standing in for structure. The claims recite algorithms in most cases, which mitigates; the risk is in the ones that do not:

| Claim | Term | Risk | Algorithm in spec |
|---|---|---|---|
| 53 | "a validator that denies an action class that is irreversible and not identity-bound unless a reversible path is recorded" | Medium: nonce-like, function-only | [0356] validator returns problems list; cite as steps |
| 53 | "a consistency test that fails when a gated action reachable by a shell command lacks a matching deny rule" | Medium | [0356] "A mirror test requi..." and [0360]; the matching algorithm (pattern vs deny list) is thin; see claim 130 |
| 53 | "an interrupt gate that stops only ..." | Medium-low: "gate" has art meaning but "stops" is functional | [0062], [0134] |
| 38 (37) | "a reaper" | Low-medium | [0070] one clause |
| 47, 127 | "a bootstrapper" | Medium-low; stages recited | [0345]-[0348] |
| 156 | "a control authority" | Medium: nonce for a server; the service-binding identity limitation helps | [0386] |
| 1 | "an execution queue" | Low | [0042] |

Mitigations: use "one or more processors configured to" only with the algorithm recited as steps (already done in 58, 67, 81, 95, 120, 134, 144); add "in a memory" structure; for the five claims above recite the concrete data structure (table, deny list, claim row) in the claim body.

---

## 4. 35 USC 101 risks per independent claim and the technical hook

Framework: Alice step 2A prong 2 / step 2B. All claims manipulate records and run on processors; the strongest hooks are improvements to computer operation (concurrency, failure containment, memory/database failure, security, cost of inference) rather than business or management methods. Claims whose body reads as "organizing human activity" (management hierarchy, goals, owner cards, projects) are the exposed ones.

| Claim | 101 exposure | Concrete hook the spec supports |
|---|---|---|
| 1 (hierarchy) | High: "portfolio manager / program manager / ranking / allocation" is a managerial, mental-process-like allocation | [0036]: per-tick snapshot table `program_risk_now` replaced a nested view that "had caused the database to fail with an out-of-memory error" (risk view ran in 28 ms while nested plan failed). Claim 4 captures this; pull into claim 1. Also [0033]-[0034] tool-layer denial by requester identity (claim 14), [0033] writer-keyed rows |
| 15 (plus loop) | Medium-high: choose a product, make a change, measure | [0051] keep-or-revert with baseline of outcome and guard measure; stale/missing reading treated as unmeasured, not a pass ([0053] stored as NULL not 0) - a data-integrity improvement |
| 24 (earned autonomy) | High: trust score computing is a mathematical concept plus mental process | [0060]-[0062]: rung selects an execution path (added review vs. none) and reversible forms constructed (backup, flag, canary); control of a computer system based on measured outcomes. Anchor to the "path selection and revert" step |
| 33 (self-amending) | Medium-high: rule-making by matching text | [0066] replay against stored records and protected-limit check; claim 36 refusal handling. Hook is thin; present as a self-modifying policy with a rollback-capable reviewed change |
| 37 (change path) | Low: fencing token, two-family review, deploy lock, probe revert are computer-concurrency/safety techniques | [0068]-[0070]: write accepted only with live token and current fence so a paused holder cannot overwrite; verbatim evidence-line check; revert on a probe that passed before and fails after |
| 47 (bootstrap) | Medium: automation of setup; better than most | [0345]-[0348]: guarded stages, exit code 0/2, idempotent `INSERT OR IGNORE` seed, presence-only credential detection |
| 53 (policy as data) | Low-medium: data-driven permission enforcement and a consistency test between two security configurations | [0356], [0360]: test that every gated shell pattern appears in the harness deny list - a concrete security consistency check; claim 130 |
| 60 (recognition and redirect) | High: it rewrites text outputs by rule and adjusts a score; resembles natural language editing | [0111]-[0116]: gate before emission, execute-and-verify the abandoned action in the same cycle, read-back identifier; tie the claim to "executing the action and emitting only after read-back verifies" |
| 67 (tick/trust system) | Medium-high: arithmetic trust updates | [0130]: trust never reaches permission checks, secrets, interrupt gate, alignment floor - an access-control limit; per-step evidence record `tick` identifier |
| 72 (mandate) | High: time budgets for stages of a business process | [0146] breach procedure at tick; [0147] multi-path DoD; support is prophetic ([0150]). Weakest independent claim |
| 74 (two schedulers) | Low: dead-man check across independent schedulers is a reliability technique | [0164]-[0165]: no shared process or next-fire state, slot counting; [0159] next_fire written whether or not the post succeeded (claim 75) |
| 88 (goals) | High: goal authoring with ratification is organizational | [0194]-[0207]: objectives store writable only by ratification action; token-set Jaccard/containment dedup [0199] (a computer-specific technique, claim 89); authentication check on mutation (claim 92) |
| 46, 95, 100, 144 (kit, WBS, experiments, owner cards) | High: configuration, project states, statistics, UI for a management queue | 46: boundary check [0361]-[0362]; 95: dependency re-evaluation on Done [0218]; 100: identical windows [0240]; 144: claim-before-filing prevents duplicate hand-backs [0399] |
| 81, 107, 120, 134 (graph, admission, failure registry, boundary probes) | Medium | 81: degree/density graph metrics [0177]; 107: live-bundle scan [0267], lower confidence bound [0277]; 120: scanned = executed + failed + needs_human + no_action invariant [0331]; 134: single read-only probe [0363]-[0364] |
| 102 (routing) | Low-medium: cost-aware inference routing | [0256], [0262]: capability matrix; "a cheaper model that does not emit [tool calls] costs more through retries"; deterministic handler avoids model call; cost per verified outcome |
| 114 (audit) | Medium-high: evaluative reasoning and recordkeeping | [0292]: clock read in the same call; [0310]: claim states and deciding query; hook is reading the live system state and not closing on code-only evidence |
| 127 (bootstrap + tick) | Medium | [0345]-[0354]; best-supported claim with real code behavior |
| 143 (email code login) | Low 101 risk (security), High 103 risk | [0387]-[0389]; hash only, constant-time compare, conditional update for once-use. Likely anticipated by ordinary OTP login; keep limited to the combination with step-up and destructive classification |
| 144 (owner cards) | High: user-interface for a management queue | [0395]-[0399]: conditional status update claim before filing prevents duplicate hand-backs; restore on failure. Technical effect at [0399] is "a duplicate or lost hand-back is prevented by a claim before filing" - recite it |

Cross-cutting: add to each independent claim a step in which the processor deploys, reverts, refuses a write, denies a tool call or throttles a schedule on the computed result; claims 1, 33, 60, 72, 88, 95, 100 end in records or rankings. Claims 46, 72, 88, 95, 100, 144 are the most exposed; their only hooks are [0076] (tick as data), [0146]-[0147] (prophetic), [0199]/[0205] (token-set dedup, authenticated mutation), [0215]-[0219] (dependency re-evaluation), [0240]-[0242], [0398]-[0399] (claim-before-filing).

---

## 5. Claim-support matrix (112(a) written description / enablement)

Legend: S = strong (algorithm, thresholds and example). M = moderate (described, no example or only generic). W = weak (named only, status prophetic, or contradicts). N = no literal support (term or limitation does not appear).

### Claim 1
S: personas [0032]-[0033]; risk and slot allocation [0037]-[0038], [0040]; ranking and `issue_priority_scores` [0041]; execution queue [0042]; action record = `persona_actions` from_value/to_value [0043] ("prior value", "scoring table" are paraphrases); enumerated operations [0033]. M: executors that "generate changes" [0031], [0068].

### Claim 15
S: product register [0048]; reserved share [0048]; selection and no in-flight plus [0049]; additive change and prediction [0049]-[0050]; baseline, keep-or-revert, stale = not a pass [0051], [0053]. M: "quality measure" per product record (only [0019] mentions it; the register columns at [0049], [0053] show usage).

### Claim 24
S: prediction record [0055]; trust ledger and score [0057]; rung mapping and transition record [0057]; added review at lower rungs [0060]. M: verifying with a probe and updating counts [0055] steps 506-510.

### Claim 33
S: register [0064]; threshold 3 in 7 days, replay, protected limits, lineage [0066]. M: "messages of a human principal against the register" - [0066] scans principal messages for friction phrases, not clearly the same register.

### Claim 37
S throughout: [0070] token/expiry/fence; [0068] disjoint families, verbatim evidence line; [0069] deploy lock, probes, revert. "Refusal determined by code" M. Claim says fence "greater than any previous"; spec "previous plus one" (narrower, supported).

### Claim 46
S: [0076], [0077], [0361]-[0362].

### Claim 47
| Element | Spec | Rating |
|---|---|---|
| idea file with idea, users, outcomes, constraints | [0343]-[0344] | S |
| "as the sole human input" | none | N (the bootstrapper also reads organization configuration and policy files per [0342], [0346]) |
| detect credentials by presence only | [0346] | S |
| select model tier from budget | [0347] | S |
| plan roles/backlog/predictions/gate cards; write charter, roles, policy, seed SQL | [0346]-[0348] | S |
| provision DB and worker with heartbeat; start first tick | [0348] step (f)-(g); [0341]: "first provisioning of a real cloud account by the seed has not been performed" | M-W: dry-run only |
| "after the starting no step executes on a computer of the human" | none | N |

### Claim 53
| Element | Spec | Rating |
|---|---|---|
| ceiling and per-action-class reversible/identity-bound flags | [0355]-[0356] | S |
| validator denying irreversible, non-identity-bound action without reversible path | [0356] | S |
| interrupt gate writes gate card; card closes when probe observes human step | [0062], [0355] | S |
| harness settings allow broadly, deny gated classes | [0360] | M ("allow broadly" not literal) |
| consistency test gated shell command vs deny rule | [0356] ("A mirror test requi..."), [0360] | M |

### Claim 60
| signature + redirect register incl. conditional offer, question, menu, principal-as-actor | [0064], [0108]-[0110] | S |
| matching draft output before emission | [0111]-[0116] (FIG. 16), but embodiment C pre-emission filter is prophetic ([0119]); hourly scan embodiments built | M-W for pre-emission |
| excluded classes: refusal with reason; irreversible identity-bound with no reversible form; live claim | [0064], [0112], [0115] | S |
| rewrite per redirect; execute and verify in same cycle; emit as done | [0113], [0115] | S |
| hit record; reduce trust value by weight | [0127] weights, [0115] | S for method; the event weights are prophetic ([0131]) -> M |

### Claim 67
| ordered tick with 8 named steps | [0122]-[0125] (twenty-step tick); "pull from a driver" | M: check naming |
| evidence record per step: tick id, step, result, time | [0072], [0122] | S |
| baseline, decay per unexercised tick, weights up/down, hidden failure > each increase | [0127]-[0128] | S as text; W as to implementation: [0131] "event weights and per-tick decay are prophetic (not yet built)" |
| ladder position and transition record | [0057] | S |
| scope changes only through reviewed revertible path; no position changes permission check, secret store, interrupt gate, alignment floor | [0130], [0134], [0060] | S |

### Claim 72
| mandate with decide-implement-deploy-verify | [0145] | S |
| time budget per stage; file item on breach; one blocking question at twice | [0146] | S text; W status ([0150] prophetic) |
| single DoD with evidence, primary/remediation/workaround paths | [0147] | S |
| "rejecting a process definition having exactly one path" | [0147]: "a step with exactly one path is a gap to close" | W: no rejection mechanism |

### Claim 74
| two schedulers sharing no process/next-fire state | [0164] | S |
| run ledger per-step record; executor updating run record queued/running/ok/failed | [0162] | S |
| expected slots from schedule expression; counting records per scheduler | [0164] steps 1820-1822 | S |
| work item priority split: first when no record from either, lower when from one | [0164] step 1826 says single-path failure when "exactly one produced a record"; [0165] says no alert fires | W/contradiction (section 0) |

### Claim 81
| enumerate members, bindings by type, service bindings | [0176]-[0177] | S |
| in/out degree; island/sink/source; unresolved; density; ghosts/unregistered/unversioned; composite score | [0177] | S |
| dimension scores with evidence pointer and confidence; mean | [0189]-[0190] | M: "confidence" per dimension not shown (evidence pointer and gap are) |
| dashboard and owner digest from same stored state | [0183], [0185] | M |
| work item for each dimension falling by threshold without recorded cause | [0190] (0.5 or more, kaizen candidate) | M |

### Claim 88
| ratified objectives writable only by ratification action | [0193]-[0194], [0205] | S |
| candidates with falsifiable DoD; classify instrumental vs objective revision; queue without adopting | [0195]-[0198] | S |
| score, reject below threshold or similarity >= threshold in window | [0199] (0.5 score threshold; 0.6 similarity; 30 days) | S |
| anchor test; derived goal with parent and alignment statement; novel goal probation | [0200]-[0201] | S |
| retire on done, stale limit, superseded | [0204] | S |

### Claim 95
S: [0209]-[0219] (spec idle expiry is 24 h).

### Claim 100
| experiment record, identical windows | [0239]-[0240] | S |
| combine two independent signals or extend window | [0240](b) | S |
| stop at earliest of window close, guard breach, futility | [0242] | M: rules (2)-(4) are "illustrative" |
| promote on positive delta on at least two metrics, else drop with rationale | [0242] | S |

### Claim 102
| capability matrix keyed by task class and model | [0256] | S |
| deterministic handler returns without model call | [0254] | M |
| select lowest-cost passing rung | [0256]-[0258] | S |
| spend cap breach selects cheaper/free rung | [0260]-[0261] | S |
| validate against schema and deterministic check; retry within bound | [0258]-[0259] | S |
| cost per verified outcome | [0262] | S text; measurement view prophetic ([0255], [0262]) |

### Claim 107
| (a) scan sources and bundles for banned models | [0267] | S |
| (b) context/output floors with exemption registry | [0268] | S |
| (c)-(d) capability test, label agreement, lower confidence bound, gate | [0277] | S |
| (e) scheduled tests and shadow sample; (f) demote on rolling agreement | [0278] "persisted matrix, shadow sampling and demotion step are Status: prophetic" | W |

### Claim 114
| live state with clock read in the same call | [0292] | S |
| findings with claim, evidence, read time, falsifier, state | [0289] | S |
| independent re-test; correction record retains superseded finding | [0293] | S |
| claim state code-only/staged/inferred/observed; close only on observed via deciding query; else pending | [0310] | S text; but [0310] closes `inferred` with label (conflict with claim 114 "otherwise ... pending") |

### Claim 120
| register rows: detector, threshold, severity | [0319]-[0320] | S |
| evidence row per execution whether or not it fires | [0320] | S |
| item with remediation contract: owner, doer, trigger, closing probe, retry bound | [0324] | M: retry bound "prophetic" |
| outcome buckets; gap; incident; reopen; block parents | [0331]-[0332] | S |

### Claims 127, 134, 143, 144
127: S, [0345]-[0354] ("unknown metric scored a miss" not located). 134: S, [0361]-[0364]. 143: S, [0387]-[0390]. 144: S, [0395]-[0399], [0390] (verify "restoring the card to open if filing fails").

Dependent-claim support flags (weak or no support): 32 (decay: only alternative [0059]; prophetic per [0131]); 66 (weights present [0127]; "narration 0.10" - narration listed in [0127] truncated line, confirm); 68 (0.5/0.01/0.30 fine; but [0355] says decay "0.01 per day", [0059] says per tick - reconcile); 73/86 (hard cap and acceleration at [0151], [0186]; [0150] says automatic breach procedure prophetic); 82 (orphan-table join prophetic, [0181]); 87 (open-question signal with weight zero: [0171]); 89 (0.5 vs 0.6); 91-94 (inferred-direction confidence formula prophetic, [0249]; "reversed by the principal" only [0251], an alternative); 99 (stalled predicate prophetic, [0227]); 111 (prophetic, [0275]); 112 (prophetic, [0285]); 113 ("uniform describe/claim/run/report interface prophetic", [0286]); 118 (automatic enforcement prophetic, [0309]); 122-123 (123 emitter detector prophetic, [0335]); 138-142 (prophetic embodiments of sections 45-46, [0362], [0365], [0370]); 150 (verify [0400]); 153 (ok); 156 (control authority is "built, partially operating" per [0386]; "before each model call and tool dispatch" fresh state - verify text).

Numbering defect: the claim-style summaries are paragraph [0081], but paragraphs [0082]-[0100] do not exist and [0101] begins section 23; the claim section sits after [0409]. A practitioner will need to renumber paragraphs consecutively before filing.

---

## 6. Dependent-claim fallback ladders; breadth; overlap

### 6.1 Ladders (pull into the independent claim if rejected)

**Family A (claim 1).** claim 4 snapshot table ([0036] OOM), then 6 (writer-keyed rows), 14 (tool-layer denial, [0034]), 7 (close-with-evidence, [0043(b)]), 12 (score formula, [0042]).
**Family B (15).** 23 (stale = NULL, [0053]), 21, 17, 18, 19.
**Family C (24).** 25, 28 (reversibility engineering, [0061]-[0062]), 27, 32, 26.
**Family D (33).** 34 (red-team), 36 (refusal handling, [0067]), 35; add [0066] protected-limit list.
**Family E (37).** 40, 38, 39 (fail-open review, [0068]); add byte-for-byte deployed-versus-source check ([0069]).
**Family F/G (46, 47).** (1) claim 51 stage guard degrade; (2) claim 52 reviewer of different family; (3) claim 48 synchronizer installs only where empty or marked ([0357]); (4) claim 132 exit codes distinguish degraded vs blocked; (5) claim 133 prediction and health response.
**Family H (claim 53).** (1) claim 54 rung bounded by ceiling, changes only by reviewed policy change; (2) claim 55 promotion/demotion tests; (3) claim 56 standing limits take precedence; add claim 130 deny-list test as an independent-claim element.
**Family R (claim 60, recognition).** (1) claim 61 excluded disposition; (2) claim 62 per-pattern redirects; (3) claim 63 surface enumeration before accepting a blocker; (4) claim 64 adopt-by-replay; (5) claim 66 weights.
**Family S (67).** (1) claim 69 evidence-completeness rate; (2) claim 70 priority multiplied by trust; (3) claim 71 gate pause rules; (4) claim 68 constants.
**Family T (74).** (1) claim 76 work claim so second start ends; (2) claim 77 outcome-bucket equality check; (3) claim 80 native cron + dispatcher; (4) claim 75 next_fire written regardless of post success; (5) claim 79 worker contract + drift states.
**Family W (81).** (1) claim 82 producer-consumer orphan tables; (2) claim 83 unmeasured != idle; (3) claim 86 SLA cap on due dates; (4) claim 85 objective value.
**Others.** 88: claims 89, 90, 92, 91. 95: 96, 98, 99. 102/107: 103, 105, 104; 108, 109, 111. 114: fix 115 first, then 117, 118, 116. 120: 121, 122, 125, 126. 127: 128, 130, 138, 141, 142. 143/144: 149, 146, 148, 156, 152.

### 6.2 Breadth ranking (by recited elements, not words)

Broadest (fewest limitations; highest prior-art exposure): 33 (118 words, 4 clauses), 100 (121), 72 (104), 46 (91, but inherits claim 1), 37 (153; but each clause is specific), 24 (169), 120 (144).
Narrowest (most limitations; high design-around risk): 127 (441 words, 12 semicolons), 81 (237, 9 clauses), 88 (218), 15 (212), 134 (201, 8), 74 (205), 67 (202), 95 (202).
Note: 127 is almost an embodiment; it is a weak infringement vehicle because a competitor can omit any one of nine guard steps.

### 6.3 Overlaps and duplicate families to merge

| Cluster | Claims | Issue | Recommendation |
|---|---|---|---|
| Trust ladder | 24, 54-55, 67, 128-129 | All claim trust score -> rung -> path with prohibited reach | Keep 24 as the family root; fold 67's evidence-record and constants into dependents of 24; keep 53/54 for policy-as-data |
| Policy as data | 53, 127 (validator, gate cards), 130, 47 | 127 re-claims 53's validator and gate card; 130 duplicates 53's consistency test | Make 127 depend on 53's policy store |
| Bootstrap | 47, 127, 138 | 47 and 127 both claim idea file -> seed -> tick; 127 is a superset | Merge into one independent (127 elements as dependents of 47) |
| Recognition/false stop | 29, 30, 60-66 | 29 and 30 duplicate 60's matching; 64 duplicates 33 (self-amending) | Make 60 the root; 33 depends or merges |
| Silent drop | 42, 77, 120, 127 (tick step) | Same reconcile invariant claimed 4 times | One independent (120) with 42 and 77 as dependents |
| Cards/queue | 28, 43, 71, 144, 152 | Interrupt/gate/card claimed 5 times | One independent (144) |
| Schedulers | 41, 74, 75, 80 | 41 is a multi-dependent restatement of 74 | Drop 41 |
| Model routing | 45, 102, 106, 107 | 45 duplicates 102(e)-(g) | Drop 45; 107 as admission family |
| Boundary check | 46, 134 | 46 recites the boundary check as a wherein clause; 134 is the full claim | Make 46 depend on 134 or delete boundary clause |

Count: roughly 26 independent-form claims (1, 15, 24, 33, 37, 46, 47, 53, 58, 59, 60, 67, 72, 74, 81, 88, 95, 100, 102, 107, 114, 120, 127, 134, 143, 144) and 157 total; USPTO excess-claim fees apply in the nonprovisional (3 independent and 20 total free). Target about 5-6 independent families.

---

## 7. Ranked top-15 fixes

1. Fix claims 58/59: restrict to method claims of a single family, remove multi-dependent and system references; add per-family system/CRM counterparts for 60-157. (1.75(c), 112(d))
2. Repair claim 74's priority rule: split into "no record from either scheduler: first priority" and "records from only one: single-path failure, lower priority, with alert"; reconcile spec [0164] with [0165] (alert vs "no alert fires").
3. Resolve 114 vs 115: change 114 to "closing the finding when the claim state is observed, or when inferred with a label and a scheduled re-test; otherwise pending", or delete 115.
4. Remove or support "sole human input" and "no step executes on a computer of the human" in claims 47/127; recite the actual boundary (credentials detected by presence only, steps the human must take placed on cards, [0346]).
5. Mark which dependent and independent elements are prophetic and add enabling detail (data structure, algorithm, example) to the spec for: event weights and decay ([0131]), service-level table and rejection of one-path definitions ([0150]), shadow sampling and demotion ([0278]), adapters and tenant isolation ([0362]-[0372]), binned calibration ([0275]), classifier ([0285]).
6. Claim 47/127/138 cluster: merge into one bootstrap family; state dry-run-only status candidly in the spec ([0341]) and keep claims to what the code does (guarded stages, exit code, idempotent seed).
7. Repair antecedent errors that change scope: 27/29/30/41/43/65 ("the agent processes"), 39 ("the review"), 60 ("the step", "the abandoned action"), 71 ("the interrupt gate"), 73 ("its open date"), 92 ("the authoring"), 135 ("claim identifiers"), 144 ("the fleet").
8. Re-parent misfit dependents: 101, 106, 112, 113, 119, 145-148, 150-151, 56 (to 54), and the 56/55 sequence under 53.
9. Fix numeric mismatches: claim 89 (0.5 vs spec 0.6, [0199]); claim 8 (spec limits demotion to critical machine-loop items, [0043(d)]); claim 5 ("severity"); claim 26 ("about"); trust decay per tick vs per day ([0059] vs [0355]).
10. Define coined terms in the claims or with "wherein" clauses: doer line, surface, action class, rung, gate card, tick, false stop, recognition, plus, kit backlog, alignment floor, entangled note, map/bridge/territory.
11. Strengthen 101 hooks: add to claims 1, 33, 60, 72, 88, 95, 100 a step in which the processor deploys, reverts, refuses a write, denies a tool call or throttles a schedule on the computed result. Pull claim 4 (snapshot table) and claim 14 (tool-layer denial) into claim 1; pull claim 130 into 53; recite the conditional-update claim-before-filing of [0398]-[0399] in 144.
12. Merge duplicate families (section 6.3); delete 41 and 45.
13. Replace relative terms: "broadly" (53), "high-priority" (2), "cheaper"/"lowest cost" (45, 102), "stale" (15, 23, 88), "significance level" (100), "ambiguous requests" (112), "about" (26).
14. Convert UI-event steps in 144 and 134 to receipt of a selection indication plus the processor-side effect.
15. Paragraph numbering: claims are [0081] with [0082]-[0100] absent and a jump to [0101]; renumber consecutively. Add a claim-to-section cross-reference table to the filing cover note so the examiner can find support.
