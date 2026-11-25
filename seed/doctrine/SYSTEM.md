# What an Ultrastable system is

Generated from `doctrine/system-contract.json` and the code by `python3 scripts/contract.py --write`. Do not edit by hand; `scripts/contract.py --check` fails when this page or the code drifts.

> Ultrastable is the foundation for any autonomous system.

## What it is

An Ultrastable system is something that has to keep running and keep improving: a loop it must close, a measure that can be wrong, upkeep that never ends and a running cost its owner accepts (VISION-1). The owner supplies the idea and the budget. The system supplies everything else, server-side, with no person in any loop: it builds, deploys, measures, repairs, improves, promotes and records itself, and it is judged only by what its code does live.

## How it runs

One clock: the Worker's cron runs the tick (worker/src/index.js scheduled, worker/src/tick.js). Every tick reads every metric, files an item for every breach and closes it when the same probe passes, hands work to roles and coding agents, merges, deploys and probes what they return (lane, handoff, sweeper), and records every step in its own database and the hash-chained audit log. GitHub Actions on their built-in token is the second route; a halt (HALT=1) stops every path at once.

Liveness metrics every system carries from its first tick (worker/src/tick.js); a breach files its own repair item:

- `M-tick-heartbeat` ticks completed in the last hour: healthy when >= 5
- `M-acting` dispatches in the last 24 hours: healthy when >= 1
- `M-closing` items finished in the last 7 days: healthy when >= 1
- `M-verified` independently verified outcomes in the last 7 days: healthy when >= 1
- `M-no-drops` silent drops in the last 7 days: healthy when <= 0
- `M-pace` share of loop runs in 24 hours that returned work (idle runs are not progress): healthy when >= 0.05
- `M-cost` largest share of a free daily limit used today (1 = the whole free day): healthy when <= 0.8
- `M-storage` share of the per-database size limit this D1 uses (1 = full: every write refused): healthy when <= 0.6
- `M-instrumented` objectives without a probe-backed target metric: healthy when <= 0

## How it bootstraps

`bootstrap/bootstrap.py` runs these stages in order. A blocked stage becomes a backlog item with an owner and a probe; only `qualify` ends a boot, for an idea that is not a system:

1. `read`: read IDEA.md, the founder's one file
2. `qualify`: refuse a one-off before anything is hired or provisioned (the system test)
3. `instrument`: write objectives and metrics; every system gets the same liveness set
4. `detect`: detect the accounts, credentials and routes that already exist
5. `select`: pick the roles the idea needs, not the whole catalogue
6. `cases`: route around each blocker from the case library; at most one owner card per blocker, with a default in effect
7. `plan`: write the first backlog, every item with an owner, a trigger and a closing probe
8. `write`: write the organisation's files into the repository
9. `surfaces`: health-check every route before relying on it
10. `org`: apply repository and organisation settings
11. `provision`: create the Worker, its database and its schedule
12. `start`: start the clock
13. `year_gate`: refuse to finish while any fault of an unattended year has no exercised drill
14. `verify_live`: done only when the deployed Worker answers /health live

## How it becomes autonomous and reaches criticality

The tick computes its own stage from its own tables (`worker/src/ignition.js`), files the first unmet one as `IGNITE-<stage>` and publishes it on `/health` and `/live`:

1. `unseeded`: nothing is running yet
2. `seeded`: the schema exists and at least one role can take work
3. `ticking`: the heartbeat completed every step for a streak of ticks and missed no slot
4. `looping`: every loop is ticking with good-slot coverage over 24 hours, watched by a second producer
5. `closing`: items close with independently verified outcomes and no silent drop
6. `instrumented`: every objective has a probe-backed target: the system is bootstrapped
7. `critical`: k_eff = verified deploys / (cost + human touches) stays at or above k_min: autonomy
8. `self-sustaining`: critical for long enough with 0 open ignition gaps and 0 human touches: criticality

Ship. Verify. Spend less than it earns. Feed the next loop. k_eff counts only deploys that were verified live; a human touch counts against it. The system computes its own stage from its own tables (worker/src/ignition.js), files the first unmet stage as IGNITE-<stage> with the numbers that block it, and publishes the stage on /health and /live.

## Invariants (each one probed on this repository by `scripts/contract.py --check`)

- **system-test** (VISION-1): It is a system, not a one-off: the bootstrap refuses an idea that fails the system test.
- **server-side-clock** (CLOCKWORK-1): It runs on its own server-side clock; no person, laptop or open session is in any loop.
- **liveness** (OBJECTIVES-1): It proves from minute one that its clock turns, its loops close and its cost and storage stay inside their limits; a breach files its own repair.
- **knows-its-stage** (BOOT-KNOWS-1): It knows how far it is from bootstrap to criticality, from its own evidence, and files what blocks the next stage.
- **criticality** (CRITICALITY-1): Its success is verified deploys per unit of cost and human touch, measured every tick.
- **server-owns-loops** (SERVER-OWNS-LOOPS-1): Coding agents only produce pull requests; the server merges, deploys, probes, closes or rolls back.
- **halt** (HALT-1): One halt stops every recurring path; pages keep serving.
- **spend-soft** (SPEND-SOFT-1): Cost is bounded without a hard stop: past the day's allowance it crawls, and what it serves never breaks.
- **goals** (GOALS-1): It sets its own goals and turns its own knobs, with a standing goal of a year unattended.
- **year-unattended** (YEAR-SIM-1): A year unattended is simulated with drills that run the real recovery code, never asserted.
- **lifecycle** (SEED-LIFECYCLE-1): It is not done until the evidence says it is autonomous; its stage is computed, never declared.
- **knowledge-graph** (DATAGRAPH-1): It keeps a self-maintained knowledge graph of all its data and proposes new connections.
- **no-static-content** (STICKY-1): Its content is produced and refreshed by its own loops; a stale or thin system files its own fix. Static content is not autonomous.
- **visible-progress** (PROGRESS-1): Every visit shows progress from merged changes; a stall dispatches its own repair.
- **promotes-itself** (TENANT-PROMO-1): Promotion is part of its role: it serves a guarded social queue and links its siblings.
- **discoverable** (DISCOVER-1): It is public and discoverable: it describes itself at /.well-known/ultrastable.json and registers in the directory.
- **measured** (INSIGHT-1): It measures its readers with cookieless first-party analytics and acts on what it reads.
- **auditable** (AUDIT-CHAIN-1): Every deploy, handoff and decision is in a hash-chained log; the database stays small by sealing, not forgetting.
- **decisions-scored** (DECISIONS-1): Every autonomous decision logs its prediction and is scored against the outcome.
- **questions-itself** (UNKNOWNS-1): It audits what it does not know and turns gaps into work.
- **plain-words** (USER-BACKEND-1): The user does the idea; the system does the backend and speaks in plain words.
- **improves-itself** (IMPROVE-1): It never runs out of improvement work, front end and back end, and keeps a change only when its metric moved.
- **syncs-both-ways** (SYNC-BOTH-WAYS-1): It pulls every platform improvement and lifts its own general code back to the platform.
- **flow-balance** (FLOW-BALANCE-1): Issue inflow never exceeds closures, and every item is inside its SLA.
- **words-match-code** (CLAIMS-1): Every public statement is bound to a probe of what the code does.
- **no-stale-branches** (BRANCH-CLEANUP-1): No branch outlives its pull request.
- **own-repository** (TENANT-REPO-1): It lives in its own repository, made from this template, and the template itself runs no loops.
- **code-is-memory** (CODE-ONLY-ORDER): Every rule and decision lives in this repository as code it consumes; every agent session loads this definition first.
