# 06 Governance and self-amendment

## Purpose
Let the rules improve from experience without letting trust rewrite its own limits.

## Concepts
- **Doctrine as data**: rules live in versioned files (`agents/AGENTS.md`, role files, `autonomy/policy.json`, `doctrine/positioning.json`); `doctrine_lineage` records each version.
- **Recognition**: the system watches its own output for known failure shapes (a question it already knew the answer to, a menu, a false stop, a handoff to a person) and corrects in the same output.
- **Friction signal**: repeated person instruction or a recurring failure signature.
- **Amendment**: a friction signal or signature that recurs (three hits in seven days from one source) becomes a proposal; it is written, tested against recent ticks, red-teamed, reviewed, adopted with a version bump.

## Invariants
1. Role files and policy change only by reviewed PR. Trust widens scope only through such a PR, never by itself.
2. Amendments cannot touch the interrupt gate, standing limits or alignment floor (honest, non-harmful, trust-preserving).
3. Every rule has a check in CI where it can: `python3 -m foundation doctrine --check`, gaplint rules GL001-GL009, `scripts/check_memory.py`.
4. Code is the only memory (`docs/PROJECT-MEMORY.md`).

## Reference implementation
`foundation/doctrine.py`, `doctrine/positioning.json`, `products/gaplint/`, `agents/AGENTS.md`.

## Status
BUILT; a larger recognition engine RUNNING in QNFO (archive §23-25).
