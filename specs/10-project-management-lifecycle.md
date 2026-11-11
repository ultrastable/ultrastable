# 10 Project management lifecycle

## Purpose
Bake good portfolio, program, product and project management into how the system works, agile and traditional (PMBOK-style), so a non-expert gets the discipline without learning the vocabulary.

## Levels
| Level | Role | Cadence | Records |
|---|---|---|---|
| Portfolio | portfolio manager | slow tick (default every 6 ticks) | risk per program, focus slot allocation, ranked outcomes |
| Program | project managers group | each tick | priority records, metrics, guard metrics |
| Product | product manager | each few ticks | product register, plus loop (spec 05), usage |
| Project | project manager | each tick | charter, work breakdown, items, claims |

## Lifecycle phases (traditional) mapped to the system
| Phase | What the system does | Output (file or row) |
|---|---|---|
| Initiating | interview, case selection, charter | `IDEA.md`, `org/charter`, gate cards |
| Planning | work breakdown (WBS) with addressing, risk and dependencies, roadmap | items with owner, trigger, done check, closing probe |
| Executing | dispatch, claims, change path | PRs, deploys, outcomes |
| Monitoring and controlling | metrics, predictions, trust, drift detector, reconciliation | `tick_runs`, `outcomes`, scorecards |
| Closing | disposition for every item, lessons, plus proposal | disposition rows, handoff notes |

## Agile practice
Iteration is the tick plus the plus loop; backlog is the item table in queue order; review is the independent reviewer plus a periodic retro that feeds amendments (spec 06); definition of done is `done_check` plus `closing_probe`; WIP is bounded by focus slots.

## Item format (any agent can finish it cold)
Problem, context, paths, acceptance criteria, test plan, closing probe, size (S/M/L), owner role, trigger.

## Reference implementation
`seed/agents/roles/`, `seed/worker/migrations/`, `docs/concepts/`, archive §32-34 for the longer treatment.

## Status
Item model and roles BUILT; WBS addressing and charter generation PLANNED in the portable core (RUNNING in QNFO).
