# What an Ultrastable system is

> Ultrastable is the foundation for any autonomous system.

This is the canonical definition every Ultrastable system is born with. The core template carries it, every agent finds it from `AGENTS.md`, the entry `CLAUDE.md` loads (the
copy at `doctrine/SYSTEM.md` in the seed is the same text), and `python3 -m foundation coldstart --check` fails when this text, the contract in
`doctrine/coldstart.json` (JSON Schema `doctrine/schemas/coldstart.schema.json`) or the code they name drift apart. The owner never supplies any of it.

## 1. Definition

An Ultrastable system is software that keeps running, measures itself, and closes its own loops: it observes, decides, changes its own code, deploys,
verifies the result live and learns from it, with no person in the loop. It passes the system test in `VISION.md` (a loop to close, a measure that can
be wrong, upkeep that never ends, a running cost the owner accepts). It is autonomous because it has self-referential loops and the ability to close
them, and it is ultrastable in Ashby's sense: a first loop keeps its essential variables in bounds, and a second loop changes its own parameters when
they leave them (`doctrine/ultrastability.json`).

## 2. What the owner does, and what the system does

The owner supplies the idea (`IDEA.md`, in their own words; spoken is enough) and a monthly budget. That is all.

The system does everything else: its repository, back end, front end, schedules, data sources, checks, deploys, repairs, improvement, promotion and
records. A step only the owner's own identity can take (their account sign-up, money, a legal signature, an org-owner permission) is one link with a
default in effect, never a task in prose (`doctrine/open-loops.json`, `foundation/data/needs-you.json`). Anything else handed to a person is a defect.

## 3. How it bootstraps (cold start)

From the seed alone, with no key, command or setting from a person:

1. `read`: the bootstrap reads `IDEA.md`.
2. `qualify`: it applies the system test and refuses a one-off with a plain not-a-fit answer.
3. `write`: it renders the org (roles, objectives, metrics, backlog, charter) from the idea.
4. `provision`: it creates the database, runs migrations and deploys the Worker with its cron, through the platform's credential-free route.
5. `year_gate`: it runs the declared fault drills against the real recovery code; a simulated year below 365 days at the 10th percentile is refused.
6. `verify_live`: it reads its own live surfaces back.

Code: `seed/bootstrap/bootstrap.py`, `deploy/deploy-seed.mjs`, `foundation/seedlaunch.py` (the end-to-end proof on a throwaway seed, then torn down).

## 4. What every system has from birth (the cold-start contract)

Each capability is in `doctrine/coldstart.json` with its rule, the seed files that carry it, its tick step, its public path and its fleet check.

- `own-repo`: its own GitHub repository, sandboxed as a tenant (TENANT-REPO-1, TENANT-SANDBOX-1).
- `backend`: a Worker and database it deploys itself (FULLSTACK-1).
- `frontend`: a public web page at `/` (FULLSTACK-1).
- `clock`: a cron heartbeat and a second producer, so no loop rests on one trigger (CLOCKWORK-1).
- `discoverable`: `/.well-known/ultrastable.json` and a daily directory heartbeat (DISCOVER-1).
- `knowledge-graph`: every row of its data as a graph, read for insights each pass (DATAGRAPH-1).
- `progress`: visible, substantive progress at its declared cadence (PROGRESS-1).
- `live-content`: content discovered and refreshed from live sources; hand-curated data is only a seed (STATIC-CONTENT-1, STICKY-1).
- `self-improve`: an improvement loop that never runs out of work, back end and front end (IMPROVE-1).
- `platform-sync`: it pulls the platform kernel and lifts its general code back up (SYNC-BOTH-WAYS-1).
- `year-unattended`: a simulated year of faults, gated at 365 days (YEAR-SIM-1, SEED-LIFECYCLE-1).
- `goals`: goals with bounded knobs it turns itself (GOALS-1).
- `instructions`: these files, identical in every system (Rules live everywhere).

## 5. How it runs

Every tick (default every 10 minutes): reconcile state, measure every metric, pull the highest-priority item, execute or dispatch it, verify it through
an independent path, score the prediction it logged, record provenance, and file a plus. Every loop is a clock in `doctrine/clocks.json`; every
failure mode has a detector in `doctrine/detectors.json`; every open item has an owner, a trigger and a closing probe. Server-side only: the Worker,
its database and GitHub Actions on their built-in tokens. A code agent session is an outside input and never a loop's owner.

## 6. How it becomes autonomous: the ignition ladder

The system reads its own stage from its own tables each tick (`seed/worker/src/ignition.js`); nothing is declared, and the first unmet stage is
filed as `IGNITE-<stage>`:

- `unseeded`: the schema is missing.
- `seeded`: the schema exists and a role can take work.
- `ticking`: the heartbeat completes every step, slot after slot.
- `looping`: every loop ticks and a second producer watches the heartbeat.
- `closing`: items close with independently verified outcomes and no silent drop.
- `instrumented`: every objective has a probe-backed target. The system is bootstrapped from here.
- `critical`: k_eff stays at or above its floor.
- `self-sustaining`: critical for a sustained run with no open ignition gap and no human touch.

## 7. How it achieves criticality

k = verified deploys in the window / (normalized cost + human touches), logged every tick (`foundation/criticality.py`, `doctrine/criticality.json`).
k_self counts only deploys the system originated and executed on itself. The regime is `subcritical` (k below the floor), `driven` (k at the floor,
k_self below it: outside sessions are carrying it) or `self-sustaining` (k_self at the floor and the bootstrap fixed point holds). When the regime
is not self-sustaining, the executor takes work that raises k_self first. The mantra, as code: ship, verify, spend less than it earns, feed the next loop.

## 8. How it stays this way

`python3 -m foundation coldstart --check` runs in `checks` on every change. It fails when the seed stops carrying a capability, when this text and its
seed copy differ or stop naming a capability, stage or regime, when a public path of the contract is hidden, when an instruction names a command that
does not exist, or when the platform and seed agent files disagree. `coldstart --live URL` probes a deployed system; the seed launch runs it on every
fresh seed. Formats are open standards: JSON with JSON Schema for contracts, AGENTS.md and CLAUDE.md for agent instructions, cron for clocks.
