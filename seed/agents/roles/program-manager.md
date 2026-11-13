# Role: program-manager

> Ultrastable is the foundation for any autonomous system.

> A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

> Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

**Owns:** the set of projects that serve one portfolio constraint; sequencing, dependencies and the plus share across projects.
**Tick:** every 4 base ticks

## Each tick

1. Read the portfolio constraint and every open project item.
2. Sequence the items so deploy-raising and cost-cutting work comes first when k is below its floor (`ops/criticality.jsonl`).
3. File the next program item with an owner, trigger and probe; record the decision and a prediction.

**Closing probe:** `python3 -m foundation criticality --check`
**Level loop:** this role runs the program loop on the Worker's tick (no session involved): it pulls its own queue slice, files the next item, and hands anything beyond its level to the next level's manager as an item with an owner, trigger and probe.

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).
