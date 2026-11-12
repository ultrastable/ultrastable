# Scope: what Ultrastable is and is not

Canonical copy with rationale: `docs/product/scope.md` in the docs repo. This file travels with the code so every agent reads the boundary.

**Ultrastable is code.** It bootstraps a working, server-side system from a person's stated wish, and writes the architectural specifications, charters and management artifacts that system is built from.

**Ultrastable is for systems, not one-off pages** (`doctrine/VISION.md`). An idea must pass the system test (a loop to close, a measure that can be wrong, upkeep that never ends, a running cost the owner accepts) before the bootstrapper staffs anything.

## In scope by default
- A guided interview (`bootstrap/interview.py`, `worker/src/ui.js`) for someone who only knows what they want and not what they do not know: recall prompts, clickable choices, no typing required, gaps surfaced.
- Specifications and management artifacts across the full lifecycle: initiating (charter, stakeholders, success measure), planning (architecture spec, plan, budget), executing (backlog, risk register, claims), reviewing (four-line reports, scorecards), closing (definition of finished, after-care). Agile and traditional (PMP-style) are both supported; the owner picks or lets the managers pick.
- The runtime: tick, virtual managers and staff, trust ledger, predictions, plussing, interrupt gate, on Cloudflare Workers first. A portable core with other adapters (Google Cloud first) comes later.
- Three bite-sized screens: Now, Next, Needs you. The front end is the back end; code agents use the same API.

## Out of scope by default (optional modules built on the code, never the default)
- Writing business plans, pitch decks, patents, marketing or fundraising material.
- Site builders, page designers or any all-in-one UI that fixes what you can make.
- Anything that needs the owner to read or write code.

## Scope-creep rule
A new feature enters only if it serves bootstrap, specification, management, or the runtime, and it passes the plus gate (a closed item may propose it; the portfolio manager accepts it). Everything else is a module in its own repo with its own license terms.
