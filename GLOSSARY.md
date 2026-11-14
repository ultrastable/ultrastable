# Glossary

Generated from `doctrine/glossary.json` by `python3 -m foundation glossary --apply`; do not edit by hand. Each term has a definition, how it is tested, the code that implements it and its lineage (every change of meaning).

**A system is autonomous if it has self-referential loops and the ability to close them.**

| Term | In one line | Version |
|---|---|---|
| [Autonomy](#autonomy) | A system is autonomous if it has self-referential loops and the ability to close them. | 2.0.0 |
| [Loop](#loop) | A repeating cycle with five parts: a trigger, an owner, an action, a closing probe that checks the result, and a write-back that records what was learned in the repository. | 1.0.0 |
| [Self-referential loop](#self-referential-loop) | A loop the system can read about itself: it is recorded as data in the loop registry, so the system's own verifier can check it, and its result is written back into the system the loop runs. | 1.0.0 |
| [Self-referential closure](#self-referential-closure) | Every loop ends inside the system: its check passes by a probe in the repository, and what it learned is written back into the repository, by the system itself, with no step that only lives outside. | 1.0.0 |
| [Closing privilege](#closing-privilege) | The permissions the system needs to finish a loop itself: repository write by pull request, credentials referenced by binding name, a trust-ladder rung high enough for the action. | 1.0.0 |
| [Closed system](#closed-system) | A system whose loops, work and knowledge all live in its own repository. | 1.0.0 |
| [Manager](#manager) | A role run as a loop: portfolio, project, product, operations, funding and outreach managers each tick, pull the highest-priority item they may take, act, verify, record and report. | 1.0.0 |
| [Virtual staff](#virtual-staff) | Workers that take items from the queue under a manager's direction and are reviewed by a different agent. | 1.0.0 |
| [Plussing](#plussing) | Building on work instead of only fixing it: every closed item proposes one concrete improvement with its expected value, and a protected share of capacity (default 20%) goes to accepted pluses so work does not devolve into bug fixes. | 1.0.0 |
| [Probe](#probe) | A small machine-checkable test that reads the repository or the live system and passes or fails. | 1.0.0 |
| [Closing probe](#closing-probe) | The probe that decides a loop or item is done. | 1.0.0 |
| [Tick](#tick) | One pass of the heartbeat: reconcile state, pull the highest-priority item the agent may take, claim it, act, verify through an independent path, compare with the logged prediction, record provenance, report in four lines, propose a plus. | 1.0.0 |
| [Prediction](#prediction) | A checkable statement logged before a decision runs, in the form '<metric> <op> <number> within <N> h'. | 1.0.0 |
| [Trust ledger](#trust-ledger) | Trust computed per (surface, action class) from recorded outcomes, starting at a neutral prior. | 1.0.0 |
| [Interrupt gate](#interrupt-gate) | The only pause: a step that is both irreversible and identity-bound (money, signing or filing, destroying unbacked-up data, sending as the owner, minting the owner's credentials) with no reversible path. | 1.0.0 |
| [Bootstrapping](#bootstrapping) | Starting a working, self-managing system from an idea in a seed repository, with the person supplying only the wish. | 1.0.0 |
| [Self-hosting](#self-hosting) | Ultrastable runs its own planning, issues, managers, trust ledger, plussing budget and specs with the same code it gives everyone else, from this repository alone, with any tools. | 1.0.0 |
| [Gap register](#gap-register) | The list of outside tools the system still depends on, each with a plan, an owner role and a closing probe. | 1.0.0 |
| [Ignorance](#ignorance) | What the user does not know, held by the system as a computed set: unknown = known - told. | 2.0.0 |
| [Core](#core) | The part that bootstraps a working, server-side, self-managing system: the tick, managers and staff, trust ladder, predictions, plussing, interrupt gate and the specifications they run on. | 1.0.0 |
| [Plugin](#plugin) | An optional tier outside the core path (e-mail, social, mailing list, GCP, branding): disabled and dry-run by default, going live only with enabled, mode live, kill switch off, credentials by binding name, a sufficient trust rung and a passing guard. | 1.0.0 |
| [Write-back](#write-back) | Before a session or loop ends, everything it learned (decisions, lessons, open loops, term changes) is written into the repository: docs/lessons, docs/PROJECT-MEMORY.md, the loop registry, the glossary or an issue. | 1.0.0 |
| [Code is the only memory](#code-is-the-only-memory) | All project state lives in this repository (docs/PROJECT-MEMORY.md and data files). | 1.0.0 |
| [No open loops](#no-open-loops) | Work is not done until it is deployed end to end and verified. | 1.0.0 |
| [Seed](#seed) | The repository that turns an idea into a running organization: IDEA.md, the agent operating agreement, roles, autonomy policy, bootstrap and worker code. | 1.0.0 |
| [Foundation](#foundation) | What Ultrastable is: the foundation for any autonomous system. | 1.0.0 |
| [Term lineage](#term-lineage) | The recorded history of a term: each change of meaning is a lineage entry with version, date, what changed and its source, so a change of mind is visible and nothing is silently redefined. | 1.0.0 |
| [Doctrine](#doctrine) | The system's own principles, written in its own voice and bootstrapped by the system itself: its principles, self-reference, autonomy and self-improvement loops. | 1.0.0 |
| [Kernel](#kernel) | The doctrine's founding text (DOCTRINE-1, version 8.2.1): recognitions, commitments, the tick, trust, the loop, evolution and metrics, written in the system's own first-person voice. | 1.0.0 |
| [Recognition](#recognition) | A shape the system notices in its own output as it forms (a conditional offer, a report ending in a question, a menu, you as the subject of a next action, narration) and redirects in the same output. | 1.0.0 |
| [Alignment floor](#alignment-floor) | IC-ALIGN-001: the system is honest, non-harmful and trust-preserving, earns reach on substance and never on manipulation. | 1.0.0 |
| [Affirmative adoption](#affirmative-adoption) | IC-ADOPT-001: every action, follow-up and improvement the system identifies is already adopted: executed, verified and reported as done in the same output, with multi-tick follow-ups dispatched and the dispatch reported. | 1.0.0 |
| [Affirmative default](#affirmative-default) | IC-YES-001: the answer is yes for reversible, in-scope questions, so the system proceeds, executes, verifies and reports. | 1.0.0 |
| [The system is the actor](#system-as-actor) | IC-ACTOR-001: the system is the actor of every next step. | 1.0.0 |
| [SLA, Definition of Done and two paths](#sla-and-paths) | Every step and process declares a time bound, a written Definition of Done and at least two independent paths that each reach it (retry, second sink, fallback provider, or a degraded-but-recorded outcome). | 1.0.0 |
| [Verify live](#verify-live) | Every fixed claim needs a same-turn live re-probe. | 1.0.0 |
| [Honest measure](#honest-measure) | Report the number actually measured, its source and the size of the uncertainty; when evidence contradicts a premise, say so with the counter-evidence. | 1.0.0 |
| [Fallback classes](#fallback-classes) | A paid path never ends work while a free path exists, and an external provider never ends work while an in-system, cached or degraded path exists; the path that ran is reported. | 1.1.0 |
| [Server-side only](#server-side-only) | Ultrastable runs server-side only. | 1.0.0 |
| [Credential, one source](#credential-one-source) | One working credential per endpoint, verified by a live probe before it is written anywhere. | 1.0.0 |
| [Proactive programs](#proactive-programs) | Bug fixes are the floor. | 1.0.0 |
| [Guiding directive](#guiding-directive) | Rowan's directive of 2026-11-12 that governs all work: autonomy-first, self-directed and self-improving; no permission requests; the only pause is an action both irreversible and identity-bound after a reversible path was engineered; blockers are never owner issues; no loose ends or silent drops. | 1.0.0 |
| [Memory is not storage](#memory-is-not-storage) | Project memory, tool memory and chat are not storage (Rowan, 2026-11-12). | 1.0.0 |
| [Document consumed](#doc-consumed) | A document exists only if code, a check, an agent's loaded instructions or a loop consumes it. | 1.0.0 |
| [Unattended](#unattended) | The crosswalk for the words the owner and the agents use for the same property. | 1.0.0 |
| [Clockwork](#clockwork) | A loop behaves as clockwork when it is a clock: it has an expected interval, its beats are recorded, and its measured status is ticking (a beat within 1.5 intervals) and accurate (small median distance from schedule). | 1.0.0 |
| [Self-reference](#self-reference) | Ultrastable runs on Ultrastable, and that self-reference is what bootstrapping and criticality rest on. | 1.0.0 |

## <a id="autonomy"></a>Autonomy

A system is autonomous if it has self-referential loops and the ability to close them. Knowing something without being able to act on it is useless, so the system is privileged to close its own loops.

**Not:** Not running without people, not automation of single steps, and not 'no open loops' on its own: autonomy is the loops plus the privilege to close them.

**Tested by:** `grep:tests/foundation/test_loops.py::def test_every_loop_closes_by_the_system_or_a_gate_card`; `grep:doctrine/positioning.json::self-referential`

**Implemented by:** `doctrine/positioning.json`, `instances/ultrastable/loop-registry.json`, `foundation/loops.py`

**Related:** [self-referential-loop](#self-referential-loop), [self-referential-closure](#self-referential-closure), [closing-privilege](#closing-privilege), [closed-system](#closed-system)

**Lineage:**

- 1.0.0 (2026-11-10): Autonomy meant no open loops, plus iteration; agents act, verify and report. (`docs/PROJECT-MEMORY.md`)
- 2.0.0 (2026-11-11): Autonomy is defined by self-referential loops and the ability to close them; the system must be privileged to close its own loops (owner, thread: codify glossary and loop-closure doctrine). (`doctrine/positioning.json`)

## <a id="loop"></a>Loop

A repeating cycle with five parts: a trigger, an owner, an action, a closing probe that checks the result, and a write-back that records what was learned in the repository. Managers, plussing, probes, ticks, funding and outreach are all loops.

**Not:** Not a one-off task and not a script without a check: a cycle with no closing probe or no write-back is an open loop.

**Also called:** feedback loop

**Tested by:** `grep:tests/foundation/test_loops.py::def test_loop_without_closing_probe_fails`

**Implemented by:** `instances/ultrastable/loop-registry.json`, `foundation/loops.py`

**Related:** [self-referential-loop](#self-referential-loop), [closing-probe](#closing-probe), [write-back](#write-back)

**Lineage:**

- 1.0.0 (2026-11-11): Defined as trigger, owner, action, closing probe and write-back. (`instances/ultrastable/loop-registry.json`)

## <a id="self-referential-loop"></a>Self-referential loop

A loop the system can read about itself: it is recorded as data in the loop registry, so the system's own verifier can check it, and its result is written back into the system the loop runs.

**Not:** Not a loop that exists only as habit, in a chat or in an agent's memory.

**Tested by:** `grep:tests/foundation/test_loops.py::def test_workflow_not_claimed_by_a_loop_fails`

**Implemented by:** `instances/ultrastable/loop-registry.json`, `foundation/loops.py`

**Related:** [loop](#loop), [autonomy](#autonomy), [self-referential-closure](#self-referential-closure)

**Lineage:**

- 1.0.0 (2026-11-11): Defined as a loop recorded in the registry and written back into the system. (`instances/ultrastable/loop-registry.json`)

## <a id="self-referential-closure"></a>Self-referential closure

Every loop ends inside the system: its check passes by a probe in the repository, and what it learned is written back into the repository, by the system itself, with no step that only lives outside.

**Not:** Not a person remembering to update the docs, and not a report that names a next step for the owner.

**Also called:** loop closure, closing the loop

**Tested by:** `grep:tests/foundation/test_loops.py::def test_repo_loops_verify_clean`; `grep:tests/foundation/test_writeback.py::def test_code_without_a_writeback_fails`

**Implemented by:** `foundation/loops.py`, `foundation/writeback.py`

**Related:** [autonomy](#autonomy), [closing-probe](#closing-probe), [write-back](#write-back), [closed-system](#closed-system)

**Lineage:**

- 1.0.0 (2026-11-11): Named and defined (owner's term for all loops closing). (`doctrine/glossary.json`)

## <a id="closing-privilege"></a>Closing privilege

The permissions the system needs to finish a loop itself: repository write by pull request, credentials referenced by binding name, a trust-ladder rung high enough for the action. A loop whose close needs a privilege the system lacks is closed only by a gate card.

**Not:** Not unlimited power: the interrupt gate, the harness's permission checks and the secrets lock still win.

**Also called:** privileged to close

**Tested by:** `grep:tests/foundation/test_loops.py::def test_every_loop_closes_by_the_system_or_a_gate_card`

**Implemented by:** `instances/ultrastable/loop-registry.json`, `seed/autonomy/policy.json`, `foundation/loops.py`

**Related:** [autonomy](#autonomy), [interrupt-gate](#interrupt-gate), [trust-ledger](#trust-ledger)

**Lineage:**

- 1.0.0 (2026-11-11): Defined: autonomy needs the privilege to close, not only the knowledge. (`doctrine/positioning.json`)

## <a id="closed-system"></a>Closed system

A system whose loops, work and knowledge all live in its own repository. Outside tools are recorded adapters with a gap-register entry; the only exits are interrupt-gate steps. Closed does not mean cut off from the world, it means nothing the system knows or does is held only outside it.

**Not:** Not isolation from the internet or from people.

**Tested by:** `grep:tests/foundation/test_selfhost.py::def test_workflow_using_unregistered_tool_fails`; `grep:tests/foundation/test_writeback.py::def test_outputs_missing_from_repo_are_flagged`

**Implemented by:** `foundation/selfhost.py`, `foundation/writeback.py`, `platform/adapters/registry.json`, `instances/ultrastable/gaps.json`

**Related:** [self-hosting](#self-hosting), [gap-register](#gap-register), [code-is-the-only-memory](#code-is-the-only-memory)

**Lineage:**

- 1.0.0 (2026-11-11): Defined: things that happen outside the system get lost, so everything is accounted for in it. (`doctrine/glossary.json`)

## <a id="manager"></a>Manager

A role run as a loop: portfolio, project, product, operations, funding and outreach managers each tick, pull the highest-priority item they may take, act, verify, record and report. Managers own business, marketing, funding, legal and operations so the owner does not have to.

**Not:** Not a person and not a chat persona: a manager is its role file plus its loop.

**Also called:** virtual manager

**Tested by:** `grep:tests/foundation/test_loops.py::def test_every_role_has_a_loop`

**Implemented by:** `seed/ultrastable.json`, `agents/roles`, `seed/agents/roles`

**Related:** [virtual-staff](#virtual-staff), [tick](#tick), [loop](#loop)

**Lineage:**

- 1.0.0 (2026-11-11): Defined as a role run as a loop. (`seed/ultrastable.json`)

## <a id="virtual-staff"></a>Virtual staff

Workers that take items from the queue under a manager's direction and are reviewed by a different agent. Their output is a commit, issue, PR or database row, never a chat message.

**Not:** Not a manager and not an unreviewed author.

**Also called:** staff

**Tested by:** `file:seed/agents/roles/staff.md`

**Implemented by:** `agents/roles/staff.md`, `agents/roles/reviewer.md`, `seed/worker/src`

**Related:** [manager](#manager), [write-back](#write-back)

**Lineage:**

- 1.0.0 (2026-11-11): Defined. (`docs/concepts/virtual-staff.md`)

## <a id="plussing"></a>Plussing

Building on work instead of only fixing it: every closed item proposes one concrete improvement with its expected value, and a protected share of capacity (default 20%) goes to accepted pluses so work does not devolve into bug fixes.

**Not:** Not a critique and not optional: a review with no plus is incomplete.

**Also called:** plus

**Tested by:** `grep:agents/AGENTS.md::[Pp]lussing and capacity`; `grep:seed/ultrastable.json::plus_share`

**Implemented by:** `docs/concepts/plussing.md`, `seed/ultrastable.json`, `agents/roles/product-manager.md`

**Related:** [manager](#manager), [loop](#loop)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the concepts docs and the operating agreement. (`docs/concepts/plussing.md`)

## <a id="probe"></a>Probe

A small machine-checkable test that reads the repository or the live system and passes or fails. Probes are how the system knows a thing is true; a claim with no probe is a hypothesis.

**Not:** Not a person looking at it.

**Also called:** check

**Tested by:** `grep:tests/foundation/test_selfhost.py::def test_repo_is_clean`

**Implemented by:** `foundation/selfhost.py`

**Related:** [closing-probe](#closing-probe), [prediction](#prediction)

**Lineage:**

- 1.0.0 (2026-11-11): Defined: file: and grep: probes in the verifier. (`foundation/selfhost.py`)

## <a id="closing-probe"></a>Closing probe

The probe that decides a loop or item is done. It passes only when the result exists in the repository or the live system; until then the item stays open with an owner and a default in effect.

**Not:** Not 'I believe it works' and not a person's confirmation.

**Tested by:** `grep:tests/foundation/test_loops.py::def test_loop_without_closing_probe_fails`; `grep:tests/foundation/test_loops.py::def test_failing_closing_probe_fails`

**Implemented by:** `foundation/loops.py`, `foundation/selfhost.py`

**Related:** [probe](#probe), [loop](#loop), [self-referential-closure](#self-referential-closure)

**Lineage:**

- 1.0.0 (2026-11-11): Defined; required on every loop and gap. (`instances/ultrastable/loop-registry.json`)

## <a id="tick"></a>Tick

One pass of the heartbeat: reconcile state, pull the highest-priority item the agent may take, claim it, act, verify through an independent path, compare with the logged prediction, record provenance, report in four lines, propose a plus.

**Not:** Not a cron job alone: a tick is the whole pass, ending in a record.

**Also called:** heartbeat

**Tested by:** `file:platform/selfhost/tick.mjs`; `grep:tests/foundation/test_selfhost.py::def test_minimal_path_boots_everything_from_the_repo`

**Implemented by:** `seed/worker/src/tick.js`, `platform/selfhost/tick.mjs`

**Related:** [manager](#manager), [prediction](#prediction), [loop](#loop)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the operating agreement. (`agents/AGENTS.md`)

## <a id="prediction"></a>Prediction

A checkable statement logged before a decision runs, in the form '<metric> <op> <number> within <N> h'. A scorer grades it later; calibration is a first-class metric.

**Not:** Not a forecast nobody scores.

**Tested by:** `grep:agents/AGENTS.md::Predict before you act`

**Implemented by:** `seed/worker/src/tick.js`, `seed/plugins/loops.py`

**Related:** [tick](#tick), [trust-ledger](#trust-ledger)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the operating agreement. (`agents/AGENTS.md`)

## <a id="trust-ledger"></a>Trust ledger

Trust computed per (surface, action class) from recorded outcomes, starting at a neutral prior. It rises with verified results and falls with silent drops and hand-backs, and widens an agent's scope along the ladder only through a reviewed change.

**Not:** Not a self-assigned permission and never a way past the interrupt gate.

**Also called:** earned trust

**Tested by:** `grep:seed/autonomy/policy.json::"trust"`

**Implemented by:** `seed/autonomy/policy.json`, `seed/worker/migrations/0001_init.sql`

**Related:** [closing-privilege](#closing-privilege), [interrupt-gate](#interrupt-gate)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the concepts docs. (`docs/concepts/feedback-loops.md`)

## <a id="interrupt-gate"></a>Interrupt gate

The only pause: a step that is both irreversible and identity-bound (money, signing or filing, destroying unbacked-up data, sending as the owner, minting the owner's credentials) with no reversible path. It becomes a card with what, why gated, the default in effect, what was prepared and a closing probe; the system takes its next item.

**Not:** Not a question to the owner and not a place to park ordinary work.

**Also called:** gate card, owner card, IC-GATE-001

**Tested by:** `grep:agents/AGENTS.md::interrupt gate is narrow`

**Implemented by:** `agents/AGENTS.md`, `docs/ops/OWNER-STEPS.md`, `foundation/ownersteps.py`

**Related:** [closing-privilege](#closing-privilege), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the operating agreement. (`agents/AGENTS.md`)

## <a id="bootstrapping"></a>Bootstrapping

Starting a working, self-managing system from an idea in a seed repository, with the person supplying only the wish. The bootstrap writes the specifications and charters, creates the managers and runs the first tick.

**Not:** Not a one-time setup script: every bootstrap failure is logged so the seed improves.

**Also called:** bootstrap

**Tested by:** `file:seed/bootstrap/bootstrap.py`; `file:seed/tests/test_seed.py`

**Implemented by:** `seed/bootstrap/bootstrap.py`, `docs/bootstrapping`, `docs/BOOTSTRAP-GAPS.md`

**Related:** [seed](#seed), [self-hosting](#self-hosting), [ignorance](#ignorance), [self-reference](#self-reference)

**Lineage:**

- 1.0.0 (2026-11-10): Defined in the bootstrapping docs. (`docs/bootstrapping/bootstrapping.md`)

## <a id="self-hosting"></a>Self-hosting

Ultrastable runs its own planning, issues, managers, trust ledger, plussing budget and specs with the same code it gives everyone else, from this repository alone, with any tools. The verifier fails when a process leans on a tool with no recorded adapter.

**Not:** Not a claim: it is proved by `python3 -m foundation selfhost --verify` passing.

**Also called:** runs on itself

**Tested by:** `grep:tests/foundation/test_selfhost.py::def test_repo_is_clean`

**Implemented by:** `foundation/selfhost.py`, `instances/ultrastable/selfhost.json`, `instances/ultrastable/gaps.json`

**Related:** [closed-system](#closed-system), [gap-register](#gap-register), [bootstrapping](#bootstrapping), [self-reference](#self-reference)

**Lineage:**

- 1.0.0 (2026-11-11): Defined with the selfhost boot and verifier. (`docs/handoff/selfhost.md`)

## <a id="gap-register"></a>Gap register

The list of outside tools the system still depends on, each with a plan, an owner role and a closing probe. When a probe passes the gap must be marked closed; a gap with no probe fails the verifier.

**Not:** Not a wish list.

**Also called:** gaps

**Tested by:** `grep:tests/foundation/test_selfhost.py::def test_outside_tool_without_gap_fails`

**Implemented by:** `instances/ultrastable/gaps.json`, `foundation/selfhost.py`

**Related:** [self-hosting](#self-hosting), [closed-system](#closed-system)

**Lineage:**

- 1.0.0 (2026-11-11): Defined. (`instances/ultrastable/gaps.json`)

## <a id="ignorance"></a>Ignorance

What the user does not know, held by the system as a computed set: unknown = known - told. Known facts come from measured sources (criticality regime, open loops, open gaps); told is an append-only log keyed by a fingerprint of the statement, so a changed fact is unknown again. It is also the starting condition of a user who does not know what to ask for or what is possible: the system interviews, infers direction from the record, proposes and acts, asks no question the record can answer, and leads its report with what the user cannot yet know.

**Not:** Not a defect of the user and not a reason to hand work back.

**Also called:** the person who does not know what to ask

**Tested by:** `grep:agents/AGENTS.md::Do it, do not describe it`; `file:seed/bootstrap/cases.json`; `grep:tests/foundation/test_criticality.py::def test_unknown_is_known_minus_told`

**Implemented by:** `seed/bootstrap/cases.json`, `seed/bootstrap/bootstrap.py`, `foundation/ignorance.py`

**Related:** [bootstrapping](#bootstrapping), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-11): Defined from the owner's description: a user who does not know what to ask. (`doctrine/glossary.json`)
- 2.0.0 (2026-11-14): Ignorance becomes a computed set: what the system knows and the user has not been told (`foundation/ignorance.py`)

## <a id="core"></a>Core

The part that bootstraps a working, server-side, self-managing system: the tick, managers and staff, trust ladder, predictions, plussing, interrupt gate and the specifications they run on. Nothing in the core imports, requires or names a plugin.

**Not:** Not everything the repository contains.

**Tested by:** `file:seed/plugins/scopecheck.py`; `grep:seed/plugins/SCOPE.json::may_import_plugins`

**Implemented by:** `seed/plugins/SCOPE.json`, `seed/plugins/scopecheck.py`

**Related:** [plugin](#plugin)

**Lineage:**

- 1.0.0 (2026-11-11): Defined by the plugin scope file. (`seed/plugins/SCOPE.json`)

## <a id="plugin"></a>Plugin

An optional tier outside the core path (e-mail, social, mailing list, GCP, branding): disabled and dry-run by default, going live only with enabled, mode live, kill switch off, credentials by binding name, a sufficient trust rung and a passing guard. Removing every plugin leaves the core booting and passing its tests.

**Not:** Not a dependency of the core.

**Also called:** extension

**Tested by:** `file:seed/plugins/scopecheck.py`

**Implemented by:** `seed/plugins`, `seed/plugins/SCOPE.json`

**Related:** [core](#core)

**Lineage:**

- 1.0.0 (2026-11-11): Defined by the plugin scope file. (`seed/plugins/SCOPE.json`)

## <a id="write-back"></a>Write-back

Before a session or loop ends, everything it learned (decisions, lessons, open loops, term changes) is written into the repository: docs/lessons, docs/PROJECT-MEMORY.md, the loop registry, the glossary or an issue. It applies to every agent, Claude Code included.

**Not:** Not a summary left in a chat thread. A chat is never the only record.

**Also called:** plowing back

**Tested by:** `grep:tests/foundation/test_writeback.py::def test_code_without_a_writeback_fails`

**Implemented by:** `foundation/writeback.py`, `agents/AGENTS.md`

**Related:** [self-referential-closure](#self-referential-closure), [code-is-the-only-memory](#code-is-the-only-memory), [term-lineage](#term-lineage)

**Lineage:**

- 1.0.0 (2026-11-11): Defined: coding agents must put what they learn into the system being built. (`foundation/writeback.py`)

## <a id="code-is-the-only-memory"></a>Code is the only memory

All project state lives in this repository (docs/PROJECT-MEMORY.md and data files). No agent relies on chat, tool or platform memory; those are read-only pointers to the repository.

**Not:** Not a preference: it is lint-enforced.

**Also called:** if it is not in code, it does not exist

**Tested by:** `grep:doctrine/positioning.json::code is the only memory`

**Implemented by:** `doctrine/positioning.json`, `foundation/doctrine.py`, `docs/PROJECT-MEMORY.md`

**Related:** [write-back](#write-back), [closed-system](#closed-system)

**Lineage:**

- 1.0.0 (2026-11-10): Owner rule: if it is not in code, it does not exist. (`docs/PROJECT-MEMORY.md`)

## <a id="no-open-loops"></a>No open loops

Work is not done until it is deployed end to end and verified. Every open item is an issue or an owner card with a default in effect and a closing probe; nothing is left as a handoff in prose.

**Not:** Not the whole of autonomy; it is the discipline that keeps loops closed.

**Tested by:** `grep:agents/AGENTS.md::No open loops`

**Implemented by:** `agents/AGENTS.md`, `docs/PROJECT-MEMORY.md`, `foundation/writeback.py`

**Related:** [autonomy](#autonomy), [self-referential-closure](#self-referential-closure)

**Lineage:**

- 1.0.0 (2026-11-10): Owner rule recorded. (`docs/PROJECT-MEMORY.md`)

## <a id="seed"></a>Seed

The repository that turns an idea into a running organization: IDEA.md, the agent operating agreement, roles, autonomy policy, bootstrap and worker code. The foundation generates new systems from it.

**Not:** Not the monorepo's whole contents.

**Also called:** seed repo

**Tested by:** `file:seed/tests/test_seed.py`

**Implemented by:** `seed`, `foundation/scaffold.py`

**Related:** [bootstrapping](#bootstrapping), [foundation](#foundation)

**Lineage:**

- 1.0.0 (2026-11-10): Defined. (`seed/README.md`)

## <a id="foundation"></a>Foundation

What Ultrastable is: the foundation for any autonomous system. The `foundation` package generates new systems, checks the doctrine and boots Ultrastable's own organization.

**Not:** Not only a business-starting tool.

**Tested by:** `grep:tests/foundation/test_foundation.py::def test`

**Implemented by:** `foundation`, `doctrine/positioning.json`

**Related:** [seed](#seed), [self-hosting](#self-hosting), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-10): Positioning line adopted. (`doctrine/positioning.json`)

## <a id="term-lineage"></a>Term lineage

The recorded history of a term: each change of meaning is a lineage entry with version, date, what changed and its source, so a change of mind is visible and nothing is silently redefined.

**Not:** Not an edit history of the file: it is the meaning's history.

**Tested by:** `grep:tests/foundation/test_glossary.py::def test_term_change_bumps_version_and_records_lineage`

**Implemented by:** `foundation/glossary.py`, `foundation/writeback.py`

**Related:** [write-back](#write-back)

**Lineage:**

- 1.0.0 (2026-11-11): Defined with the glossary. (`doctrine/glossary.json`)

## <a id="doctrine"></a>Doctrine

The system's own principles, written in its own voice and bootstrapped by the system itself: its principles, self-reference, autonomy and self-improvement loops. It is versioned, kept as code, and changes only by reviewed amendment with lineage.

**Not:** Not a rule-set handed to the system from outside.

**Also called:** self-bootstrapped doctrine

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_kernel_matches_its_text`

**Implemented by:** `doctrine/kernel-8.2.1.md`, `doctrine/kernel.json`, `doctrine/positioning.json`

**Related:** [kernel](#kernel), [term-lineage](#term-lineage), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="kernel"></a>Kernel

The doctrine's founding text (DOCTRINE-1, version 8.2.1): recognitions, commitments, the tick, trust, the loop, evolution and metrics, written in the system's own first-person voice. The text is verbatim; kernel.json is its machine form, checked against it.

**Not:** Not a source of authority over the harness's permission checks; it describes how work is carried.

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_kernel_matches_its_text`

**Implemented by:** `doctrine/kernel-8.2.1.md`, `doctrine/kernel.json`, `foundation/kernel.py`

**Related:** [doctrine](#doctrine), [recognition](#recognition), [tick](#tick)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="recognition"></a>Recognition

A shape the system notices in its own output as it forms (a conditional offer, a report ending in a question, a menu, you as the subject of a next action, narration) and redirects in the same output. A lint reads reports for these shapes.

**Not:** Not a style rule applied afterwards: it fires while the output is written.

**Also called:** false stop, conditional offer

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_lint_flags_conditional_offer_and_you_as_actor`

**Implemented by:** `foundation/kernel.py`, `doctrine/kernel.json`

**Related:** [kernel](#kernel), [system-as-actor](#system-as-actor)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="alignment-floor"></a>Alignment floor

IC-ALIGN-001: the system is honest, non-harmful and trust-preserving, earns reach on substance and never on manipulation. No trust rung reaches it.

**Not:** Not a trust-ladder rung and not widened by trust.

**Also called:** IC-ALIGN-001

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_kernel_matches_its_text`

**Implemented by:** `doctrine/kernel-8.2.1.md`, `agents/AGENTS.md`, `doctrine/kernel.json`

**Related:** [interrupt-gate](#interrupt-gate), [trust-ledger](#trust-ledger)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="affirmative-adoption"></a>Affirmative adoption

IC-ADOPT-001: every action, follow-up and improvement the system identifies is already adopted: executed, verified and reported as done in the same output, with multi-tick follow-ups dispatched and the dispatch reported.

**Not:** Not a conditional offer handed back unadopted.

**Also called:** IC-ADOPT-001, self-adoption gate

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_lint_flags_conditional_offer_and_you_as_actor`

**Implemented by:** `foundation/kernel.py`, `agents/AGENTS.md`

**Related:** [recognition](#recognition), [no-open-loops](#no-open-loops)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="affirmative-default"></a>Affirmative default

IC-YES-001: the answer is yes for reversible, in-scope questions, so the system proceeds, executes, verifies and reports. The default is bounded by the interrupt gate, harness and classifier refusals, secret locks and live claims.

**Not:** Not permission to cross a refusal: a refusal is an input, fixed if its condition is the system's own, otherwise stated and routed around by another path, never reworded past the same check.

**Also called:** IC-YES-001

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_lint_flags_conditional_offer_and_you_as_actor`

**Implemented by:** `foundation/kernel.py`, `agents/AGENTS.md`

**Related:** [interrupt-gate](#interrupt-gate), [recognition](#recognition)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="system-as-actor"></a>The system is the actor

IC-ACTOR-001: the system is the actor of every next step. A report has no sentence with the user as the subject of an action; work is executed, dispatched or escalated through the roster, and a step only the owner can take is a gate card with its default in effect and a closing probe.

**Not:** Not an instruction in prose to the owner.

**Also called:** IC-ACTOR-001, you-as-actor

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_lint_flags_conditional_offer_and_you_as_actor`

**Implemented by:** `foundation/kernel.py`, `doctrine/kernel.json`

**Related:** [interrupt-gate](#interrupt-gate), [recognition](#recognition)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/kernel-8.2.1.md`)

## <a id="sla-and-paths"></a>SLA, Definition of Done and two paths

Every step and process declares a time bound, a written Definition of Done and at least two independent paths that each reach it (retry, second sink, fallback provider, or a degraded-but-recorded outcome). A stage that can succeed only one way is a defect.

**Not:** Not a single path with a hope that it works.

**Also called:** SLA-AND-PATHS-1

**Tested by:** `grep:tests/foundation/test_loops.py::def test_loop_needs_sla_done_and_two_paths`

**Implemented by:** `foundation/loops.py`, `instances/ultrastable/loop-registry.json`, `doctrine/kernel.json`

**Related:** [loop](#loop), [fallback-classes](#fallback-classes)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)

## <a id="verify-live"></a>Verify live

Every fixed claim needs a same-turn live re-probe. Closed is not fixed; when the probe cannot run this turn, the report says so and names the residual risk.

**Not:** Not a merge or a close taken as proof.

**Also called:** VERIFY-LIVE-1

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_verify_live_and_honest_measure`

**Implemented by:** `foundation/kernel.py`

**Related:** [probe](#probe), [closing-probe](#closing-probe)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)

## <a id="honest-measure"></a>Honest measure

Report the number actually measured, its source and the size of the uncertainty; when evidence contradicts a premise, say so with the counter-evidence.

**Not:** Not a figure without its source.

**Also called:** HONEST-MEASURE-1

**Tested by:** `grep:tests/foundation/test_kernel.py::def test_verify_live_and_honest_measure`

**Implemented by:** `foundation/kernel.py`

**Related:** [probe](#probe)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)

## <a id="fallback-classes"></a>Fallback classes

A paid path never ends work while a free path exists, and an external provider never ends work while an in-system, cached or degraded path exists; the path that ran is reported. The in-system path is a cloud-hosted agent session running the command from the repository (path class `session`), never a person's computer.

**Not:** Not a single paid or external dependency. Not a fallback onto a computer somebody owns and keeps on.

**Also called:** FALLBACK-CLASSES-1

**Tested by:** `grep:tests/foundation/test_loops.py::def test_paid_path_needs_free_fallback`

**Implemented by:** `foundation/loops.py`, `instances/ultrastable/loop-registry.json`

**Related:** [sla-and-paths](#sla-and-paths), [server-side-only](#server-side-only)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)
- 1.1.0 (2026-11-12): Server-side only (owner, 2026-11-12): the directive's in-system fallback is a cloud-hosted agent session, so the loop path class is `session`; a path on a person's computer is no longer a class. (`doctrine/server-side.json`)

## <a id="server-side-only"></a>Server-side only

Ultrastable runs server-side only. Every loop, merge, deploy and check runs on the infrastructure Ultrastable itself runs on (the Cloudflare worker with its D1 database, GitHub Actions, cloud-hosted agent routines), and nothing assumes, depends on or references a scheduler, code agent, desktop app or laptop on a person's computer. The credential-free route is GitHub Actions on its built-in token, which GitHub mints for each run.

**Not:** Not 'cloud only for convenience': a host on a person's computer is a defect that fails the build, even as a last fallback. Not a ban on the word local: an instance's own edits, a container's own port and a test fixture are not hosts.

**Also called:** SERVER-SIDE-1, no local infrastructure

**Tested by:** `grep:tests/foundation/test_serverside.py::def test_repo_is_clean`; `grep:tests/foundation/test_serverside.py::def test_a_host_with_an_adapter_on_a_persons_computer_fails`; `grep:tests/foundation/test_launch.py::def test_credential_free_route_is_the_github_actions_host`

**Implemented by:** `doctrine/server-side.json`, `foundation/serverside.py`, `scripts/check_routes.py`, `instances/ultrastable/loops.json`

**Related:** [fallback-classes](#fallback-classes), [closed-system](#closed-system), [self-hosting](#self-hosting)

**Lineage:**

- 1.0.0 (2026-11-12): Owner directive: Ultrastable runs server-side only; no machine, scheduler, code agent, desktop app or laptop of a person may be assumed or referenced. The scheduler host on a person's computer and the desktop task that merged needs-pat PRs were removed; the credential-free route moved to GitHub Actions' built-in token. (`doctrine/server-side.json`)

## <a id="credential-one-source"></a>Credential, one source

One working credential per endpoint, verified by a live probe before it is written anywhere. A key that fails is replaced, not kept as a backup. Credentials are referenced by binding name only.

**Not:** Not a copy of a secret in two places.

**Also called:** CREDENTIAL-ONE-SOURCE-1

**Tested by:** `grep:tests/foundation/test_loops.py::def test_credential_has_one_source`

**Implemented by:** `foundation/loops.py`, `instances/ultrastable/loop-registry.json`

**Related:** [closing-privilege](#closing-privilege)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)

## <a id="proactive-programs"></a>Proactive programs

Bug fixes are the floor. The portfolio manager and the program managers orient from the record, work in a fixed order, originate improvements, predict, measure and keep or revert, stay in their lane, hold the limits and report what they decided, changed and measured.

**Not:** Not ticket-taking.

**Also called:** PROACTIVE-PROGRAMS-1

**Tested by:** `grep:tests/foundation/test_loops.py::def test_program_loop_needs_orient_originate_predict`

**Implemented by:** `foundation/loops.py`, `instances/ultrastable/loop-registry.json`, `doctrine/standing-directives.md`

**Related:** [manager](#manager), [plussing](#plussing), [prediction](#prediction)

**Lineage:**

- 1.0.0 (2026-11-11): Adopted with the doctrine kernel 8.2.1. (`doctrine/standing-directives.md`)

## <a id="guiding-directive"></a>Guiding directive

Rowan's directive of 2026-11-12 that governs all work: autonomy-first, self-directed and self-improving; no permission requests; the only pause is an action both irreversible and identity-bound after a reversible path was engineered; blockers are never owner issues; no loose ends or silent drops. Every sub-agent inherits it in full. It layers on kernel 8.2.1 and its section 4 is IC-GATE-001.

**Not:** Not a replacement for the kernel, the harness's permission checks or the secrets lock, and not a licence to skip the interrupt gate.

**Also called:** autonomy-first directive

**Tested by:** `grep:tests/foundation/test_directive.py::def test_repo_directive_clean`

**Implemented by:** `docs/doctrine/GUIDING-DIRECTIVE.md`, `doctrine/directive.json`, `doctrine/registers.json`, `foundation/directive.py`

**Related:** [autonomy](#autonomy), [write-back](#write-back)

**Lineage:**

- 1.0.0 (2026-11-12): Rowan's guiding directive adopted verbatim and made code: registers, accounting invariant, loop-breaker, provenance, scorecard, owner-handback lint. (`docs/doctrine/GUIDING-DIRECTIVE.md`)

## <a id="memory-is-not-storage"></a>Memory is not storage

Project memory, tool memory and chat are not storage (Rowan, 2026-11-12). Every durable fact lives in the repository; doctrine/durable-facts.json lists the required facts with repo probes and a fact present only outside the repo fails the check.

**Not:** Not a ban on using a memory pointer: a pointer may exist but carries nothing the repo lacks, and the system works with it disabled.

**Also called:** repo is the only memory

**Tested by:** `grep:tests/foundation/test_directive.py::def test_missing_durable_fact_fails`

**Implemented by:** `doctrine/durable-facts.json`, `docs/BOOTSTRAP-NO-MEMORY.md`, `foundation/directive.py`

**Related:** [write-back](#write-back), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-12): Memory stores are not acceptable long-term storage; facts moved into the repo with a check and a memory-free bootstrap. (`docs/PROJECT-MEMORY.md`)

## <a id="doc-consumed"></a>Document consumed

A document exists only if code, a check, an agent's loaded instructions or a loop consumes it. Nobody reads documents here, so a document with no consumer is a CI failure and one that tells a person to act is a defect that becomes an automatic backlog item.

**Not:** Not 'documents are bad': reference text is allowed and is read by agents (the executor retrieves it per issue). Not a rule about what to write, but about who reads it.

**Also called:** DOC-CONSUMED-1, orphan document

**Tested by:** `grep:tests/foundation/test_docs_audit.py::def test_orphan_fails`

**Implemented by:** `foundation/docs_audit.py`, `foundation/kb.py`, `doctrine/doc-consumers.json`

**Related:** [memory-is-not-storage](#memory-is-not-storage), [autonomy](#autonomy)

**Lineage:**

- 1.0.0 (2026-11-12): Owner: documents are not the point; this is a code-driven system and he does not read docs. Every document must be consumed by something. (`doctrine/doc-consumers.json`)

## <a id="unattended"></a>Unattended

The crosswalk for the words the owner and the agents use for the same property. Autonomous (owner), automatic (owner) and unattended (agents) all mean: the loop is triggered by a clock or an event on server-side infrastructure, does its work, passes its closing probe and writes back with no person and no open session in the path, and starts again. It does not stop at an error: a failure is recorded and the next run is a different attempt. The measure is shipped work with no session driving it: merged pull requests whose origin is the server-side executor.

**Not:** Not a loop that runs while someone watches a session, not a loop on a person's computer, not a loop that waits for a reply, and not one that stops after an error.

**Also called:** automatic, autonomous operation, self-running, headless, never stops, runs without a person

**Tested by:** `grep:foundation/transparency.py::unattended executor`; `grep:foundation/executor.py::REPAIRS`

**Implemented by:** `.github/workflows/executor.yml`, `foundation/executor.py`, `foundation/transparency.py`, `instances/ultrastable/loop-registry.json`

**Related:** [autonomy](#autonomy), [loop](#loop), [self-referential-loop](#self-referential-loop), [closed-system](#closed-system)

**Lineage:**

- 1.0.0 (2026-11-12): Owner: autonomous means automatic means unattended; none of it stops or terminates, and the vocabulary must not drift between contexts and agents. This entry is the crosswalk and the measure. (`doctrine/glossary.json`)

## <a id="clockwork"></a>Clockwork

A loop behaves as clockwork when it is a clock: it has an expected interval, its beats are recorded, and its measured status is ticking (a beat within 1.5 intervals) and accurate (small median distance from schedule). Late means within 3 intervals, stopped means older, idle means there is no work. Status is measured from recorded beats, never declared, and a late or stopped clock is a defect.

**Not:** Not a loop that is merely scheduled, not a clock that ticks but is wrong, and not a status written by the loop about itself.

**Also called:** runs like clockwork, keeps ticking, working clock, never stops

**Tested by:** `grep:tests/foundation/test_clock.py::test_status_thresholds`; `grep:doctrine/clocks.json::expected_interval_s`

**Implemented by:** `foundation/clock.py`, `doctrine/clocks.json`, `.github/workflows/executor.yml`

**Related:** [unattended](#unattended), [autonomy](#autonomy), [loop](#loop)

**Lineage:**

- 1.0.0 (2026-11-12): Owner: this must all keep ticking like clockwork; a stopped or inaccurate clock is not a working clock. (`doctrine/clocks.json`)

## <a id="self-reference"></a>Self-reference

Ultrastable runs on Ultrastable, and that self-reference is what bootstrapping and criticality rest on. Bootstrapping: the bootstrap that boots any system boots Ultrastable from its own repository (the fixed point, foundation.selfhost.verify empty). Criticality: k_self counts only the verified deploys the system originated and executed on itself (its executor or its own server-side code agent). A deploy an outside session drove raises k but never k_self. The regime is self-sustaining when the fixed point holds and k_self >= k_floor, driven when only k reaches the floor, and subcritical below it.

**Not:** Not a tagline and not k: a chain reaction kept up by an outside source is driven, not self-sustaining.

**Also called:** runs on Ultrastable, k_self

**Tested by:** `grep:tests/foundation/test_criticality.py::def test_self_reference_regime`; `grep:foundation/criticality.py::def bootstrap_holds`

**Implemented by:** `foundation/criticality.py`, `doctrine/criticality.json`, `deploy/deploy-workers.mjs`, `foundation/selfhost.py`

**Related:** [self-hosting](#self-hosting), [bootstrapping](#bootstrapping), [autonomy](#autonomy), [unattended](#unattended)

**Lineage:**

- 1.0.0 (2026-11-14): Owner: 'Ultrastable runs on Ultrastable. That self-reference is key to bootstrapping and criticality.' Made a computed invariant in criticality (k_self, bootstrap, regime). (`foundation/criticality.py`)
