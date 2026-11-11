# 03 Work, tick and claims

## Purpose
Make work visible, finite and never silently dropped.

## Concepts
- **Tick**: a periodic heartbeat (default every 10 minutes, `*/10 * * * *`). Seed worker steps in order: `reconcile`, `reap_claims`, `probe_gates`, `score_predictions`, `accrue_trust`, `dispatch`, `check_plus_share` (`seed/worker/src/tick.js` `STEP_ORDER`). The doctrine kernel describes a longer 20-step tick (archive §24).
- **Item**: `id, title, kind (work|plus|fix|amendment|ladder), project, owner_role, trigger_on, done_check, closing_probe, priority, status, disposition, blocker`.
- **Claim**: a fenced hold on an item or path, with an owner and expiry; fence numbers increase per path, so a stale writer is rejected.
- **Gate card**: an open request for a person for one identity-bound step; never auto-closed (spec 04).

## State machine
`open → ready → claimed → done`; or `blocked` (owner, blocker, probe), `superseded`, `cancelled`. An item leaves the active set only with a **disposition**. An item that leaves without one is a **silent drop**: an incident that reopens it.

## Procedure per tick
1. Reconcile: compare items against reality; mark stale claims; find silent drops.
2. Reap claims whose holders stopped; release with the next step.
3. Probe gates: each gate card has a closing probe that is rerun.
4. Score predictions and accrue trust (spec 04).
5. Dispatch the highest-priority item the role may take; one tick record is written with steps completed and total.
6. Check the plus share (spec 05).
Every tick writes evidence (`tick_runs`); a missing tick is detected by a second scheduler.

## Invariants
1. Never swallow an error: a failure is logged and becomes an item.
2. A live claim held by another agent is theirs; do not duplicate work; reviewing a claimed change is allowed.
3. Kill switches, daily caps and circuit breakers bound every loop.

## Reference implementation
`seed/worker/src/tick.js`, `seed/worker/test/tick.test.js`; QNFO claims in `platform/cloudflare-reference/` (deploy-guard fence allocation).

## Status
BUILT (seed worker, tests); RUNNING in QNFO with a richer step set.
