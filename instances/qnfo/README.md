# Instance: QNFO

**Ultrastable is the foundation for any autonomous system.** QNFO is the proof case: an existing autonomous research fleet that adopts the foundation. QNFO is a separate brand from Ultrastable.

## Adoption path (no rewrite)
1. `python3 -m foundation validate --manifest instances/qnfo/instance.json` passes (CI-tested).
2. `python3 -m foundation new-system --manifest instances/qnfo/instance.json --out <scratch>` produces the kernel files, memory file, cases and owner cards for QNFO (CI-tested with a fixture).
3. Copy `agents/`, `autonomy/policy.json` and `docs/PROJECT-MEMORY.md` from the scratch output into the QNFO repository through a reviewed PR there, beside the running fleet; nothing is replaced.

## Closing probe (QNFO repositories are outside this session's scope)
Open PR in `QNFO/qnfo-workers` titled "Adopt the Ultrastable foundation kernel" whose diff contains `agents/AGENTS.md`, `autonomy/policy.json`, `docs/PROJECT-MEMORY.md`; `python3 -m gaplint` run there reports 0 findings. Until then the adoption is PLANNED, verified only against fixtures here.
