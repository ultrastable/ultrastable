# Spec: Per-Agent / Per-Harness Quality Scoreboard (ROADMAP-1, QNFO.OPS #AGENT-SCOREBOARD)

## Goal
Provide a scoreboard aggregating quality metrics per agent and per harness, derived from intake attribution, mergeable and verifiable live via a probe the author did not write (VERIFY-LIVE-1).

## Attribution Source
Intake attribution: each completed roadmap item records the agent identity, harness (runner/runtime), and closing probe outcome at intake/merge time. Attributed fields are immutable once an item is merged.

## Scoreboard Fields
Per row (agent x harness):
- agent_id, harness_id
- items_completed (count)
- first_pass_merge_rate (merged without rework / completed)
- probe_pass_rate (VERIFY-LIVE-1 passed on first probe / probed)
- median_time_to_merge
- rework_cycles (avg reopens per item)

## Probe Criteria (VERIFY-LIVE-1)
A probe is valid when:
1. Written by someone other than the item's implementing author.
2. Exercises the scoreboard live (not stubs): asserts correct aggregation for at least two seeded agents and one seeded harness.
3. Runs in CI against the deployed surface and passes.

## Done Check
PR merged to main AND VERIFY-LIVE-1 probe (author-independent) green in the live environment.

## Out of Scope
DB-only changes; leaderboard UI polish; historical backfill beyond available attribution data.
