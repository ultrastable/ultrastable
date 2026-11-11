# Product scope and hard boundaries (decided 2026-11-11, Rowan)

Ultrastable is **code**. Code can do many things (draft patents, write business plans), but those are modules built on it, not what it is.

## What it does by default
1. **Bootstraps** a working, server-side system from what a person says they want. The person need not write or read code, and need not know what they do not know.
2. **Writes architectural specifications, charters and management artifacts** for that system: portfolio, program, product and project management, agile and traditional (PMP-style). Lifecycle: initiating, planning, executing, reviewing, closing, each with its artifact (see `seed/bootstrap/interview.py`, `render_specs`).
3. **Runs it**: heartbeat, virtual managers and staff, trust ledger, predictions, plussing, interrupt gate.

## What it does not do by default
Business plans, pitch decks, patents, marketing, fundraising, site building. Optional modules, separate repos, separate terms. Hard rule: scope grows only through the plus gate (see `seed/SCOPE.md`).

## The user it is designed for
Someone who can say what they want but does not know what to ask for. Therefore:
- Prompted recall: every question carries hints; people recognize answers rather than invent them.
- Clickable choices first; free text only for the idea and success measure.
- Gap surfacing: answers trigger "things you did not know to mention" (privacy, payments, support, rules).
- Three bite-sized screens: Now, Next, Needs you. The front end is the back end. Code agents can use the same API (`/api/answers`).
- Never required: command line, code, reading logs.

## Position
Between all-in-one AI site builders (friendly but bounded by what the platform allows) and code agents (unbounded but assume an engineer). Ultrastable keeps the search-box/prompt familiarity, adds guidance so nobody has to know what to type, and produces real code and specs the owner keeps.

## AIOS lessons applied
Boot never dies (a missing credential becomes a backlog item and the boot continues); no swallowed errors; verify inputs before depending on them; pick the model tier from budget like AIOS picked by RAM; idempotent re-run. See `docs/bootstrapping/aios-lessons.md`.

## Demo and proof
QNFO is the live demo of what the system produced starting from nothing and zero hand-written code; the fleet dashboard is the model for the 3-screen summary.
