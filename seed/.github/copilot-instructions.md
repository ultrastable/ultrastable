# Copilot instructions

Follow `agents/AGENTS.md` (the org's shared agent protocol) and the role file in `agents/roles/` named on your assigned item. Your limits are in `autonomy/policy.json`. Make the smallest complete change, run the repo's checks, never commit secrets, and finish with verification evidence.

The guiding directive (`doctrine/GUIDING-DIRECTIVE.md`, GUIDING-DIRECTIVE) governs all work and every sub-agent inherits it in full; project and tool memory are not storage, so load everything from the repository.

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).
