# AGENTS.md

The protocol for every agent in this repo is in [`agents/AGENTS.md`](agents/AGENTS.md). Read it first, then your role file in [`agents/roles/`](agents/roles/). Limits: [`seed/autonomy/policy.json`](seed/autonomy/policy.json). Before a session ends, write what it learned into the repository (`python3 -m foundation writeback record`); nothing stays in a chat thread.

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).
