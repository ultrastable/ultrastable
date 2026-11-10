# Ultrastable claim strategy (memo for the patent attorney, not for filing)

Prepared 2026-11-10 with draft version 2 of the specification. Keep this memo out of the filed application: describing prior-art gaps or "what the invention is" in the specification itself can later be read as an admission or as a limit on the claims.

## 1. What distinguishes Ultrastable: the key claims

Eight independent claim families (G, bootstrapping from an idea and seed, claim 47; H, autonomy policy as data, claim 53; added after the table). Each is tied to a technical effect, because the U.S. *Alice* test, the EPO's technical-effect test and China's technical-solution test all turn on that.

| # | Independent claim | What it covers | Technical effect to argue | Nearest prior art and the gap |
|---|---|---|---|---|
| A | 1: management hierarchy | Persona records with enumerated operations. A portfolio agent allocates focus slots by risk. Program agents rank items with metric-linked items first and write priority rows that an execution queue reads. Every operation is logged with its prior value. | Bounded, auditable and reversible machine control of a shared work queue by many agents. No overwrites between writers (claim 6). The snapshot table avoids database out-of-memory failure (claim 4). | MetaGPT, ChatDev and CrewAI give LLM agents role names (CEO, PM, engineer) inside one task conversation. None allocates capacity across a standing portfolio by measured risk, or writes priority into a dispatch queue under enumerated authority. PPM and OKR software allocate capacity, but humans make the decisions. |
| B | 15: plus loop | A product register separate from programs. A reserved improvement share that repair work cannot take over. One additive change with a prediction. Baseline captured at verified deploy, then keep or revert on outcome plus guard. Missing data counts as a fail. | The managed system's measured state improves without operator input, with automatic rollback of changes that don't help. | A/B testing and experimentation platforms measure changes that people design. Autonomous SRE remediates incidents. None reserves capacity for unrequested, agent-generated improvements of healthy products with a keep-or-revert ratchet. |
| C | 24: earned autonomy | Predictions stored and scored. A trust ledger per surface and action class with a prior. A ladder whose rung selects the execution path. | Agent permissions become a computed function of verified outcomes, not static configuration. | Reputation systems and Bayesian trust in multi-agent systems score agents, not action classes over live production paths. Agent platforms gate with static allow-lists or human approval. |
| D | 33: self-amending governance | A signature register matched against agent output. Recurrence produces a proposal, which is replayed against stored ticks and adopted only by a versioned change that leaves protected limits untouched. | A control policy that corrects measured failure modes of the agents themselves, with a bounded change surface. | Prompt-optimization research (DSPy, self-refine) tunes prompts against benchmarks. It does not amend a deployed governance policy from production signatures under protected limits. |
| E | 37: change path | Fenced claims, two-family model review with verbatim evidence, a code-made hold, a deploy lock, and probe-triggered revert. | Prevents stale writes and duplicate work. Cuts false positives in model review. Bounds time-to-recovery. | Each piece exists separately (fencing tokens, canary analysis such as Kayenta, AI code review). The combination for many heterogeneous coding agents may be found obvious, so it is a weaker independent claim. Keep it as a fallback and as dependents. |
| F | 46: organization kit | A core that is unchanged across tenants, configured by programs, products and executors, plus a boundary check. | Reuse without code change. | Probably the weakest alone (it resembles multi-tenant SaaS configuration). Keep it for commercial coverage. |
| G | 47: bootstrapping from a seed | An idea becomes a charter, then owner cards, then a seed instantiated (agreement, authority file, core), then server-side ticks run the organization. | An organization is created and operated from one statement with no interactive session afterwards. A non-overwriting sync keeps every agent product on one agreement. | Repo templates and scaffolders (cookiecutter, create-* CLIs) generate code, not a self-operating organization with gated authority and trust-adjusted permissions. The AIOS lineage ([0078i]) supports physical-media and server variants. Caution: the first real cloud provisioning has not run, so [0078j] flags the wording. |
| H | 53: autonomy policy as data | Per-surface ceilings and reversible/identity-bound flags; a validator; a narrow interrupt gate with self-closing gate cards; harness deny rules checked against the policy by a test. | Policy and enforcement cannot drift apart; permissions are maximal yet bounded. | Static allow-lists and approval prompts (agent products) have no flagged action classes, no drift test, and no ceiling-bounded trust ladder. |

**Strongest positions (in our view):** A combined with C, and B. If claim 1 meets prior art, the best fallback amendments are: claim 1 + claim 12 (queue score including trust), claim 1 + claim 24 elements (trust-selected path), and claim 15 + claims 17 to 19 (plus-the-plus, rest, simplify).

**Detectability:** every claim element leaves records an infringer would also need (allocation rows, priority rows, action logs with prior values, prediction rows, trust rows). Discovery can show them, and a product's audit UI often exposes them.

**Single actor:** all claims are performed by "the system". No step requires a human, which avoids divided infringement.

## 2. Support check: every claim element to the specification and a figure

| Claim | Elements | Spec paragraphs | Figures |
|---|---|---|---|
| 1 | persona records, enumerated ops | [0017], [0029] table, [0031] to [0033] | 2 |
| 1 | portfolio risk and allocation | [0036] to [0040] | 3 (302 to 308) |
| 1 | program ranking and priority rows | [0041] | 3 (310) |
| 1 | execution queue dispatch | [0042] | 1 (108, 112) |
| 1 | action records with prior value | [0029], [0043] | 3 (312, 316) |
| 2 to 3 | risk formula, even plus risk split, escalate | [0037] to [0040] | 3 |
| 4 | snapshot table | [0036] | 3 (304) |
| 5 to 6 | tiers; own-rows-only | [0033], [0041] | 3 (310) |
| 7 to 9 | close, demote, doer assign | [0043](b), (d), (e) | 3 (312) |
| 10 | origination | [0044] | 3 (314) |
| 11 | root cause | [0046] to [0047] | 8 |
| 12 | queue score formula | [0042] | 1 |
| 13 | config switch | [0045], [0073] | 3 |
| 14 | plane separation by requester | [0034] | 9 (906f) |
| 15 to 23 | plus loop | [0048] to [0054] | 4 |
| 24 | predictions, scoring | [0055] to [0056] | 5 |
| 24 to 26 | trust ledger, ladder, path | [0057] to [0060] | 6 |
| 27 to 28 | top rung bounds; reversibility; gate | [0060] to [0062], [0065] | 6, 11 |
| 29 to 30 | false stops; self-adoption | [0063] to [0064] | 6 |
| 31 to 32 | trigger parsing; decay | [0055], [0059] | 5 |
| 33 to 36 | self-amending governance | [0066] to [0067] | 7 |
| 37 to 40 | change path, claims, review, probes | [0068] to [0070] | 10, 12 |
| 41 | dual scheduler heartbeat | [0072] | 1 |
| 42 to 43 | reconciliation; principal queue | [0071] | 11 |
| 44 | kill switch and drill | [0073] | 1 (104) |
| 45 | model ladder | [0074] | 13 |
| 46 | organization kit | [0076] to [0078] | 9, 14 |
| 47 to 52, 57 | bootstrapping from an idea and a seed | [0078a] to [0078c], [0078g] to [0078i] | 14, 15 |
| 53 to 56 | autonomy policy as data, ceilings, gate cards, harness consistency test, trust bounds | [0078d] to [0078f] | 6, 11, 15 |
| 58 to 59 | system and medium | [0028] | 14 |

Every element has a paragraph and a figure. Numeric fallbacks (thresholds, caps, windows) appear as examples, so the attorney can claim narrower values later without new matter.

## 3. Items for attorney review

1. **Prior public material (open question for the attorney only).** The key combination has not been publicly disclosed. The QNFO repository `QNFO/qnfo-workers` is public under the QNFO User License Agreement v2.1 (no commercial use; patent applications must cite QNFO) and is a separate effort that has existed since August 2026. Ask the attorney to inventory what, if anything, overlaps with the claimed combination and on which dates, and to advise on timing. This document asserts no prior disclosure.
2. **§101.** Claims 1, 15, 24 and 33 could be characterized as "organizing human activity" or "mental processes". The draft ties them to database records, triggers, dispatch to executor processes, deployment and probe-triggered revert. Consider adding "deploying" and "reverting" steps to claims 15 and 24 explicitly, and naming the snapshot or memory effect in claim 1.
3. **§112(f).** Avoid "module for" and "means" wording in the non-provisional. The draft uses process and record language.
4. **Inventorship.** Rowan is the sole human conceiver on the record (dated owner directives in the migrations). AI-implemented details need a significant human contribution per the USPTO February 2024 guidance and the *Pannu* factors. Confirm no other person contributed.
5. **Prior-art search** before the non-provisional: MetaGPT (Hong et al. 2023), ChatDev (Qian et al. 2023), AutoGen, CrewAI, Devin, GitHub Copilot coding agent, Factory, Overcut, Traversal, Netflix and Google canary analysis (Kayenta), fencing-token leases (Kleppmann), Bayesian reputation (Jøsang beta reputation), self-evolving coding-agent surveys (for example arXiv 2608.03392), and Ashby's ultrastable system (concept only, no software).
6. **Customer-zero numbers** ([0079]): these are the system's self-reported figures. Keep them as examples or remove them.
7. **Trademark** "Ultrastable" for software: a separate search and application.
8. **Continuations:** consider a provisional per new loop as the platform grows, all rolled into one non-provisional within 12 months of the first.
