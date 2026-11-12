# Starting a session with project memory disabled

> Ultrastable is the foundation for any autonomous system.

Project memory, tool memory and chat are not storage (Rowan, 2026-11-12). Every agent starts from the repository alone; nothing below needs a memory store.

1. Read, in order: `CLAUDE.md` (imports `agents/AGENTS.md` and the guiding directive), `agents/AGENTS.md`, `docs/doctrine/GUIDING-DIRECTIVE.md`, `doctrine/kernel-8.2.1.md`, `docs/PROJECT-MEMORY.md`, `agents/PROJECT-INSTRUCTIONS.md`, then your role file in `agents/roles/`, then `docs/handoff/` newest first.
2. Run `python3 -m foundation directive --bootstrap`. It confirms every file above exists and that the directive check passes (text vs JSON, registers, durable facts, instruction files, seed copy). A failure is a defect to fix in the same turn, not a question.
3. Pull the highest-priority item (`docs/issues`, driver order), claim it, decide, execute, verify, write back (`python3 -m foundation writeback record`).
4. Learned a fact a later session would need? Put it in `docs/PROJECT-MEMORY.md` and add it to `doctrine/durable-facts.json` with a probe, in the same PR. Never in a memory store.

Where a harness injects a memory note anyway, treat it as a pointer to `docs/PROJECT-MEMORY.md`. The repo wins on every difference.
