# Prior art register (IP-2)

Status 2026-11-10: web search of non-patent literature only; NO patent-database search was run (agent sessions here have web search, not USPTO/EPO/Google Patents query tools). A professional patent search by counsel is still required before relying on this. Each row: reference, what it teaches, how the Ultrastable disclosure differs, and the claim families that carry the difference (families A to H of CLAIM-STRATEGY.md).

| # | Reference | Teaches | How we differ | Families |
|---|---|---|---|---|
| 1 | Ashby, *Design for a Brain* (1952): ultrastability | A machine that changes its own settings when an essential variable leaves limits | Concept only; no software method of scored predictions, trust ledger, or reviewed self-amendment under protected limits | G |
| 2 | MetaGPT (Hong et al., 2023) and ChatDev (Qian et al., 2023): LLM agents in company roles | Role-assigned agents (PM, engineer, reviewer) complete a requested software task | Roles execute a task a person requests; no standing portfolio allocation by risk, no persistent ledgers, no plus loop, no trust-gated scope, no live-probe revert | A, B, C |
| 3 | Graduated-autonomy and agent trust-score write-ups (e.g. AWS Architecture Blog on graduated autonomy; vendor trust-score docs for agents, 2025-26) | Trust scores or autonomy levels for agents, often policy-set or reputation-based | We compute trust per (surface, action class) from verified post-deployment outcomes with a prior, bind it to execution path and origination rights, bound rungs by a permission ceiling and protected limits, and change rungs only by reviewed change | C |
| 4 | Canary analysis and automatic rollback (Flagger, Argo Rollouts, Spinnaker/Kayenta, cloud deploy tools) | Roll back a rollout when metrics breach | Rollback is one element only; we pair it with claims+fence, two-family evidence-gated review, a scored prediction per change and keep-or-revert of additive pluses after a window | D, B |
| 5 | AIOps / self-healing remediation (incident-driven agents; "agentic AIOps" talks) | Agents remediate incidents when triggered | Attention allocated by failure only; we reserve capacity for improving healthy products, originate work from metrics and roadmaps, and score our own judgment | B, A |
| 6 | Cloud coding agents and orchestration (Devin, Codex cloud, Copilot coding agent, Factory) | A person assigns tasks to executors | We treat those as executors under one claim ledger; the system chooses the work | A, E |
| 7 | Agent control planes/gateways and governance tools (RBAC, audit logs, sandboxing) | Static permissions and logging | Permissions are earned and computed, with an interrupt gate that stops only irreversible identity-bound actions after reversibility engineering | C |
| 8 | Forecast scoring (Brier/proper scoring rules; Metaculus, prediction journals) | Score probabilistic forecasts | We use scoring of an agent's own operational decisions as a control signal feeding scope, queue order and amendments | C, G |
| 9 | Distributed locks with fencing tokens (Kleppmann, 2016) | Fence values prevent stale writers | Applied to concurrent heterogeneous coding agents with expiry, renewal and orphan metric; we claim the combination, not fencing | E |
| 10 | Pixar "plussing" (improv/creative practice) | Build on an idea additively | Human practice; ours is a protected-capacity, predicted, measured keep-or-revert loop with guard measures and simplify passes | B |
| 11 | Self-evolving agent surveys (Zhou et al., arXiv 2608.03392 as cited in product design doc) | Self-modifying coding agents; open problems of reversibility and feedback reliability | We address those with protected limits, replay-tested amendment and recorded outcomes | G |
| 12 | Constitutional/ policy-as-prompt approaches | Governance in prompt text | Ours is enforced by data, triggers, validators and CI consistency tests; amendments arise from recorded friction | G |

## Risk notes
- Rows 3 and 4 are the closest: attorney should search granted claims on trust-gated agent autonomy and deploy auto-rollback; independent claims lean on the combinations (predictions scored -> trust -> path; plus-loop reserved share; evidence-gated two-family review).
- Obviousness exposure: individual elements exist; novelty rests on the closed-loop combination, so keep dependent-claim fallbacks (see QA review).
- Add counsel's search results and update this table; keep private.
