# 09 Interface

## Purpose
Sit between two failures: all-in-one site builders that limit you at their boundary, and command-line code agents that assume you are an engineer. The common denominator is a search box and now an AI prompt, but people do not know what to ask, so the interface offers.

## Principles
1. **Three screens, bite-sized.** The home view has at most three screens: *what is happening* (a handful of numbers), *what needs me* (the gate cards, at most three at a time), *what next* (suggested actions). Detail is one tap away, never on the home view.
2. **Buttons before typing.** Every screen shows the likely next actions as buttons; a free-text box is always present but never required.
3. **Guided walk-through first.** The first run is a wizard built from the interview (spec 08). It differs per person because the questions come from their seed and the case library.
4. **The front end is the back end.** Everything the interface does is a record write the system also performs; there is no hidden admin path. Nothing requires reading code.
5. **A code agent can use the same back end.** The same endpoints and records are open to Claude Code, Copilot or Codex for people who want them. That is an access path, not the target user.
6. **Honest status.** Numbers show source and age; self-scored numbers are labelled; nothing is claimed that the records do not show.
7. **Interrupt budget.** The interface surfaces only gate cards (spec 04) and digests (spec 05). No per-event notifications.

## Records the interface reads and writes
`gate_cards`, `items`, `outcomes`, `tick_runs`, `trust_ledger`, plus a `suggestions` view (top candidate next actions with expected value) and the interview answers.

## Reference implementation
`dashboard/` (Cloudflare worker, `/owner`, panels from `snapshot.json`); the QNFO fleet dashboard (customer zero) is the design source; the personal companion's simplified day screen is the second. The guided interview UI is PLANNED.

## Status
Dashboard RUNNING (owner view). Three-screen home and interview wizard: PLANNED.
