# 08 Bootstrapping for people who do not know what to ask

## Purpose
Start from nothing and reach a running system as good as a development team would build, for a person who can say what they want and does not know what they do not know. They never write code or look under the hood. This is the part of the product that matters most.

## Concepts
- **Seed**: one file, `IDEA.md` (org name, owner, an idea paragraph, who it is for, first outcomes, constraints). It is the only human input.
- **Prompted recall**: the system supplies the questions. A person recognizes a good answer far more easily than they invent a requirement, so the interview offers choices, examples and defaults and records what was chosen. Unknowns are recorded as assumptions with a default in effect, not as blockers.
- **Case library**: starting conditions (no entity, no domain email, no budget, no credentials, a failing portal) map to routes with a probe and, only where a step is identity-bound, one owner card (`seed/bootstrap/cases.json`).
- **Specification pack**: what the bootstrap writes for the system the person asked for: architectural specifications (in the form of these specs), charter, roles, work breakdown, backlog, gate cards, boot log.
- **PID 1 never dies**: a missing credential never stops the boot; the step becomes a backlog item with blocker and closing probe and the rest continues.

## Procedure
1. **Read** the seed. **Detect** facts (domicile, budget, credentials, devices) and fill defaults conservatively.
2. **Interview** (guided, in the interface of spec 09): offer the next three questions, with options and a "not sure, use the default" button. Each answer is a commit.
3. **Select** cases and roles; **plan** the specification pack; write it as files.
4. **Provision**: dry run first; apply once with credentials from the secret store (by binding name). Every apply step is idempotent.
5. **Start** the heartbeat; managers take over; later steps start from the tick, not from a person.
6. **Report** in four lines: what happened, what was decided, what is next, what is open.
7. **Self-improve**: any bootstrap failure is logged and becomes a case or a role change by PR, so the seed improves.

## Invariants
1. The person is never the actor of a next step; steps only they can take are gate cards (spec 04).
2. Nothing public happens until the person says so; default is private.
3. Defaults work as-is: an empty answer must yield a safe, working system.
4. The bootstrap writes architectural specifications by default; it does not write business plans, patents or filings unless an extension is switched on (spec 00).

## Reference implementation
`seed/bootstrap/bootstrap.py`, `seed/bootstrap/cases.json`, `seed/bootstrap/cases.py`, `foundation/` (`new-system`, preflight, credential ladder), `seed/IDEA.md`, `seed/docs/bootstrapping.md`, `seed/docs/aios-lessons.md`, `docs/BOOTSTRAP-GAPS.md`.

## Gaps (BUILT vs PLANNED)
Seed to files and dry run: BUILT with tests. Real cloud `--apply`: PLANNED (no run yet). The guided interview UI: PLANNED (spec 09). Generation of the full specification pack from the interview (this spec set as a template): PLANNED. Patent-filing cases (BC-1, BC-2) and the filing-route planner are extension content to move out of the default seed (handoff note).
