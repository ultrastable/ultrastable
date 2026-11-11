# Instance: Ultrastable

**Ultrastable is the foundation for any autonomous system.** This instance is Ultrastable running its own launch as its first managed project. Brand separate from QNFO. Manifest: `instance.json`. Regenerate the scaffold with `python3 -m foundation new-system --manifest instances/ultrastable/instance.json --out /tmp/ultrastable-instance`.

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).
