# Ultrastable overview (internal full version)

**Ultrastable is the foundation for any autonomous system.**

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

Tag: NDA ONLY. External version: [../external/overview.md](../external/overview.md). Status words: **RUNNING** (in production, in QNFO), **BUILT** (code and tests in this repo), **PLANNED**.

## One sentence
Ultrastable is an autonomous development platform: a virtual organization of managers and staff that runs a portfolio of work end to end, scores its own decisions, earns wider autonomy from its track record, and stops only for steps that cannot be undone.

Name: W. Ross Ashby's *ultrastable system* (1952), a machine that changes its own settings when an essential variable leaves its limits.

## The story in seven parts

1. **The problem.** AI coding agents multiply effort but still need a person to pick the work, check the result and notice drift. The person becomes the bottleneck and the single point of failure.
2. **Virtual managers and staff.** A **portfolio manager** (allocation across projects), **project managers** (delivery), **product managers** (roadmap and user value), **staff** (execution), **reviewers** (independent verification, never the doer) and **operations**. Roles are configuration, so any organization maps onto them. See [concepts/virtual-staff.md](concepts/virtual-staff.md). BUILT as role files and tick scheduling in `seed/`; RUNNING in QNFO.
3. **Closed feedback loops.** Every decision logs a checkable prediction first; a scorer compares it with the outcome; items carry an owner, a trigger and a closing check; nothing leaves the active set without a disposition. BUILT in `seed/worker/src/tick.js` (7-step tick); RUNNING in QNFO at scale. [concepts/feedback-loops.md](concepts/feedback-loops.md).
4. **Plussing.** Improvement is planned work. Every closed item proposes a "plus"; a reserved share of each cycle (default 20%) funds accepted pluses; fix-only streaks trigger a rebalance. BUILT (plus-share check in the tick); RUNNING in QNFO. [concepts/plussing.md](concepts/plussing.md).
5. **Earned-trust autonomy with one interrupt gate.** A trust ledger scores each (surface, action class) from verified outcomes and moves it along a ladder from observed to self-extending. Autonomy widens only through reviewed changes. Agents pause only for steps that are both irreversible and identity-bound (money, signatures, legal filings, deleting unbacked-up data), and first try to engineer a reversible path. BUILT (ledger, ladder, gate cards); RUNNING in QNFO. [concepts/governance.md](concepts/governance.md).
6. **Self-amending operating rules.** Repeated failures and friction become proposed rule changes, tested against past ticks and adopted by review; the policy is versioned like code. RUNNING in QNFO; seed ships the policy file and amendment items, PLANNED for automated simulation in the product.
7. **Bootstrapping from an idea.** A person writes `IDEA.md`; the seed's bootstrapper reads it, plans the organization, writes the repo and policy, provisions the runtime and starts the heartbeat. BUILT and tested (12 Python tests); a real `--apply` on a fresh cloud account has NOT been run (roadmap BS-3); the model-calling executor is next (BS-4). [bootstrapping/bootstrapping.md](bootstrapping/bootstrapping.md).

## The surfaces

| Surface | What it is | Status |
|---|---|---|
| Back end | Tick, store, roles, policy; portable core with Cloudflare and Google Cloud adapters | core BUILT; CF RUNNING; GCP skeleton BUILT, undeployed. [architecture](../platform/docs/architecture.md) |
| Dashboard | Live view of loops, trust ledger, open gate cards, predictions, issues by area | `docs/ISSUES-BY-AREA.md` is a generated stand-in; the product dashboard is being built in a sibling thread. PLANNED |
| Command line | Bootstrap, status, approve a gate card, run a tick from a cloud-hosted session | `seed/bootstrap/bootstrap.py` is BUILT; a unified `ultrastable` CLI is PLANNED |
| Seed | Idea to running organization | BUILT, tests pass, cloud apply not yet run |

## Lessons carried over from QNFO and AIOS
From the QNFO fleet (customer zero): ledgers instead of claims (every decision, prediction, outcome and trust change is a table); probes with automatic revert on deploy; two-model-family review for risky diffs; work-claim ledger so many agents do not collide; the "affirmative default" voice that makes agents act instead of asking. From AIOS (bootable USB with local models): PID 1 must never die, so every tick step is guarded; verify inputs; never swallow errors; pick the model by available budget the way AIOS picked it by RAM. Details: [bootstrapping/aios-lessons.md](bootstrapping/aios-lessons.md).

## What is built vs planned, plainly
- RUNNING in QNFO, one installation, one customer (the owner's own fleet). Its numbers are **self-scored**: the system measures itself, with no outside audit. See [customer-story.md](customer-story.md).
- BUILT in this repo: seed bootstrapper, 7-step tick, schema, policy, role files, GCP adapter skeleton, tests (12 Python, 9 Worker, 2 GCP).
- NOT built: multi-tenant packaging, installer, product dashboard, unified CLI, model executor, Postgres dialect, any deployment on Google Cloud, any outside customer, any outside audit.

## Match to the IP
The seven parts above correspond to the specification's figures: FIG 1 system, 2 virtual staff, 3 manager tick, 4 plus loop, 5 predict-verify, 6 trust gate, 7 self-amend, 8 root cause, 9 any organization, 10 work claims, 11 reconcile queue, 12 change path, 13 model ladder, 14 deployment, 15 bootstrap ([ip/provisional/](../ip/provisional/README.md)). The patent is an unfiled draft for attorney review, not legal advice.
