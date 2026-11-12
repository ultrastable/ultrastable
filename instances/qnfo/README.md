# Instance: QNFO

**Ultrastable is the foundation for any autonomous system.** QNFO is the proof case: an existing autonomous research fleet that adopts the foundation. QNFO is a separate brand from Ultrastable.

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

## Adoption path (no rewrite)
1. `python3 -m foundation validate --manifest instances/qnfo/instance.json` passes (CI-tested).
2. `python3 -m foundation new-system --manifest instances/qnfo/instance.json --out <scratch>` produces the kernel files, memory file, cases and owner cards for QNFO (CI-tested with a fixture).
3. Copy `agents/`, `autonomy/policy.json` and `docs/PROJECT-MEMORY.md` from the scratch output into the QNFO repository through a reviewed PR there, beside the running fleet; nothing is replaced.

## Closing probe (QNFO repositories are outside this session's scope)
Open PR in `QNFO/qnfo-workers` titled "Adopt the Ultrastable foundation kernel" whose diff contains `agents/AGENTS.md`, `autonomy/policy.json`, `docs/PROJECT-MEMORY.md`; `python3 -m gaplint` run there reports 0 findings. Until then the adoption is PLANNED, verified only against fixtures here.

## Update 2026-11-12: instance of the core, not a copy
QNFO pins the kernel in `ultrastable.lock.json` and the runtime code by `runtime.ref` (a tag of `ultrastable/workers`), and holds only config, plugins and domain content. Full model and the alignment with the workers cutover plan (#103): `docs/architecture/core-and-instances.md`.

| Workers cutover stage (`docs/cutover/PLAN.md`) | Core/instance meaning here | Status |
|---|---|---|
| 0 Inventory and contract | `core-contract.json`, parity contract, `extraction/boundary.json` | BUILT |
| 1 Config extraction | QNFO writes `instance.runtime.json` in its own repo; `upstream check` validates it | PLANNED (gap X-1, needs QNFO repo access) |
| 2 to 6 Shadow, data, traffic, tick, shims | runtime work in `ultrastable/workers`; shims S-1..S-7 are the QNFO overlay (`plugins/`, `domain/`) | PLANNED |
| 7 Replace | `python3 -m foundation upstream adopt --out <QNFO checkout> --name QNFO --slug qnfo` and a lock with `runtime.ref` | PLANNED (gap X-3, QNFO fleet lane opens the PR) |
| 8 Retire | old workers deleted after 14 quiet days | PLANNED |

Closing probe: `python3 -m foundation upstream check --instance <QNFO checkout>` exits 0 and `node tools/parity_smoke.mjs --from <old> --to <new>` exits 0.
