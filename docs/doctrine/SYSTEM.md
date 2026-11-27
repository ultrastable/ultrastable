# What an Ultrastable system is

> Ultrastable is the foundation for any autonomous system.

This is the canonical definition every Ultrastable system is born with. Every agent loads it through `CLAUDE.md`, and a seeded system keeps it at
`doctrine/SYSTEM.md`. Paths are written from the root of the kit (the seed). The generated index `SYSTEM.md` names the code behind each clause
and, for every clause off its shrink-only list of bare definitions, the kit test that proves it; `scripts/system.py` fails when a path named
here outside a "Platform:" paragraph is missing from the kit, or when the criticality formula below is not the one in
`autonomy/criticality.json`. The owner supplies none of it.

Platform: the core keeps this text at `docs/doctrine/SYSTEM.md`, byte for byte the seed's copy, and `python3 -m foundation coldstart --check` fails
when this text, its seed copy, the contract in `doctrine/coldstart.json` (JSON Schema `doctrine/schemas/coldstart.schema.json`) or the code they
name drift apart.

## 1. Definition

An Ultrastable system is software that keeps running, measures itself, and closes its own loops: it observes, decides, changes its own code, deploys,
verifies the result live and learns from it, with no person in the loop. It passes the system test in `doctrine/VISION.md` (a loop to close, a measure
that can be wrong, upkeep that does not end, a running cost the owner accepts), and `bootstrap/bootstrap.py` refuses an idea that does not. It is
autonomous because it has self-referential loops and the ability to close them, and it is ultrastable in Ashby's sense: a first loop, the tick
(`worker/src/tick.js`), keeps its essential variables in bounds, and a second loop, the goals step (`worker/src/goals.js`), changes the first loop's
own parameters when they leave them. The essential variables and their limits are listed in `doctrine/constitution.json`.

Platform: the core's own second loop is `foundation/ultrastability.py`, over the essential variables in `doctrine/ultrastability.json`.

## 2. What the owner does, and what the system does

The owner supplies the idea (`IDEA.md`, in their own words; spoken is enough) and a monthly budget. That is all.

The system does everything else: its repository, back end, front end, schedules, data sources, checks, deploys, repairs, improvement, promotion and
records. A step only the owner's own identity can take (their account sign-up, money, a legal signature, an org-owner permission) is one gate card
with one link and a default in effect, not a task in prose; the tick's `probe_gates` step closes the card when its probe shows the step is done
(`worker/src/tick.js`). Anything else handed to a person is a defect.

Platform: the core keeps those gates in `doctrine/open-loops.json` and `foundation/data/needs-you.json`.

## 3. How it bootstraps (cold start)

From the seed alone, with no key, command or setting typed by a person, `bootstrap/bootstrap.py` runs its stages in order (the generated `SYSTEM.md`
lists all of them). The ones every boot must pass:

1. `read`: the bootstrap reads `IDEA.md`; a copy of the template then adopts its own identity before anything is decided from its manifest.
2. `qualify`: it applies the system test and refuses a one-off with a plain not-a-fit answer.
3. `write`: it renders the org (roles, objectives, metrics, backlog, charter) from the idea.
4. `provision`: with a hosting sign-in it creates the database, runs the migrations, seeds the rows and deploys the Worker with its cron; with none
   it raises one card with one link and tries again on the next run.
5. `year_gate`: it runs the declared fault drills against the real recovery code; a simulated year below 365 days at the 10th percentile is refused.
6. `verify_live`: it reads its own `/health` back live and accepts the boot only on a 200.

Platform: `foundation/seedlaunch.py` runs the same path end to end on a throwaway seed through `deploy/deploy-seed.mjs`, then tears it down.

## 4. How it deploys

There are two routes, and neither asks the owner for a key.

- Hosted: the platform deploys the system on its own account through its OIDC route. An `IDEA.md` that names its host (`hosted_by`) has
  `bootstrap/bootstrap.py` record the runtime and models as the host's, so no secret and no budget approval is asked of the owner.
- Own account: the Deploy to Cloudflare button reads the root `wrangler.jsonc`, which holds no placeholder and no database id. The person signs in
  to Cloudflare and authorizes GitHub on those services' own pages. The deploy script in `package.json` runs `wrangler deploy`, which creates the
  D1 database on the first deploy, and then applies the migrations by binding; a tick whose config carries the migrations applies them itself
  before it writes its first heartbeat row (`worker/src/tick.js`, `worker/test/deploy-config.test.js`).

Platform: `deploy/deploy-seed.mjs` deploys every seed in `doctrine/seed-deploys.json` through the same OIDC route as the platform workers
(`deploy/deploy-oidc.mjs`), with no stored Cloudflare credential.

## 5. What every system has from birth (the cold-start contract)

Each capability is one row of the cold-start contract, with its rule, the seed files that carry it, its tick step, its public path and its fleet check.

- `own-repo`: its own GitHub repository, sandboxed as a tenant (TENANT-REPO-1, TENANT-SANDBOX-1).
- `backend`: a Worker and database it deploys itself (FULLSTACK-1).
- `frontend`: a public web page at `/` (FULLSTACK-1).
- `clock`: a cron heartbeat and a second producer, so no loop rests on one trigger (CLOCKWORK-1).
- `discoverable`: `/.well-known/ultrastable.json` and a daily directory heartbeat (DISCOVER-1).
- `knowledge-graph`: every row of its data as a graph, read for insights each pass (DATAGRAPH-1).
- `progress`: visible, substantive progress at its declared cadence (PROGRESS-1).
- `live-content`: content discovered and refreshed from live sources; hand-curated data is only a seed (STATIC-CONTENT-1, STICKY-1).
- `self-improve`: an improvement loop whose queue does not run dry, back end and front end (IMPROVE-1).
- `platform-sync`: it pulls the platform kernel and lifts its general code back up (SYNC-BOTH-WAYS-1).
- `year-unattended`: a simulated year of faults, gated at 365 days (YEAR-SIM-1, SEED-LIFECYCLE-1).
- `goals`: goals with bounded knobs it turns itself (GOALS-1).
- `instructions`: these files, identical in every system (Rules live everywhere).

Platform: the contract is `doctrine/coldstart.json`.

## 6. Machine-readable by birth

Every repository is held to the files agents and tools read before they read the code, each on an open standard and listed with the validator
it must pass in `autonomy/repo-conformance.json`: `AGENTS.md`, `llms.txt`, `LICENSE`, `REUSE.toml`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`,
`CHANGELOG.md`, `CITATION.cff`, `publiccode.yml`, `catalog-info.yaml`, `ultrastable.json`, `.editorconfig`, Dependabot (`.github/dependabot.yml`)
and the dev container (`.devcontainer/devcontainer.json`).

- `scripts/surfaces.py` renders the identity files from `ultrastable.json`: the README blocks, `CITATION.cff`, `publiccode.yml`, `catalog-info.yaml`,
  `codemeta.json`, `llms.txt`, `REUSE.toml` and the licence copy under `LICENSES/`. It creates `CHANGELOG.md`, `CONTRIBUTING.md` and `SECURITY.md`
  only when they are missing, because people and loops add to them, and a copy of the template adopts its own identity at boot.
- `scripts/repoconform.py` reads each file against its own standard with a named validator, fails a rendered file that differs from its render,
  and reports a file or repository it cannot read as unmeasured, not as passing (REPO-CONFORM-2).

Platform: the failure-audit detector `repo-conform` (`doctrine/detectors.json`) runs `seed/scripts/repoconform.py` with `--fleet` over every
repository of `doctrine/fleet-map.json` each day (`.github/workflows/failure-audit.yml`), and a red reading files `Q-AUDIT-repo-conform` until the
same reading passes.

## 7. How it runs

A tick runs on the Worker's cron (`*/10 * * * *`), and its steps run in the order `STEP_ORDER` gives in `worker/src/tick.js`: apply pending
migrations, reconcile state, score the predictions that fell due, measure every metric, audit the failure modes, question what it does not know, turn
goal knobs, plan, dispatch and execute the highest-priority items, publish the pulse, compute criticality and read its own ignition stage. A failing
step is recorded and filed as work, and the other steps still run. A second producer (`worker/src/pulse.js`) runs a tick when the heartbeat goes
quiet, so no loop rests on one trigger. Every failure mode has a probe in `autonomy/failure-modes.json`; every open item has an owner, a trigger and
a closing probe. Server-side only: the Worker, its database and GitHub Actions on their built-in tokens. A code agent session is an outside input and
not a loop's owner.

Platform: the core keeps its clocks in `doctrine/clocks.json` and its detectors in `doctrine/detectors.json`.

## 8. What an autonomous development system does

The development loop is code, from the first idea to a change proven live. Each step is a clause in the generated `SYSTEM.md`, bound to the kit test
that proves it.

1. Intake: a person's idea becomes `IDEA.md` through the repository's own issue form (`.github/ISSUE_TEMPLATE/start.yml`, `bootstrap/intake.py`),
   taken only from the people who run the project. After that the tick files every need it finds (a breach, a failed step, a goal out of bounds, a
   question about what it does not know) as a work item with an owner role, a done check and a closing probe.
2. Plan: the `plan` step turns the goal furthest out of bounds into a task tree of small items (`worker/src/planner.js`), and an item the single-shot
   executor failed is split into steps, each naming the files it writes and the steps it waits for (`worker/src/orchestrate.js`). A plan that could
   stall or overwrite is refused.
3. Build: the Worker's own executors write code on a branch and open one pull request. The backlog lane (`runDbQueue` in `worker/src/nativeexec.js`)
   and the orchestrator (`worker/src/orchestrate.js`) put a `## Handoff` block in it, so the handoff loop deploys and verifies the change after the
   merge; the repository-queue lane opens its pull request without one and leaves the item to its own closing probe. Every lane refuses a change
   that shrinks a file or leaves a stub, and the orchestrator also refuses a step that writes outside its own files.
4. Verify: a different agent reads the change. An evidence reviewer and an adversarial reviewer read it (`worker/src/orchestrate.js`), neither a model
   that wrote a step while another model is available, and a review that did not run is recorded as not run. No server-side merge happens while a
   check is running, queued or red, or before a fresh commit has reported any check (`worker/src/greenguard.js`).
5. Ship: the lane merges a clean, green pull request (`worker/src/lane.js`), and the handoff loop deploys the workers it names from the merge commit
   (`worker/src/handoff.js`); with no deploy route bound it says so and fakes nothing.
6. Prove live: the boot is accepted only when `/health` answers 200 (`verify_live`). A handoff whose pull request carries a verify line
   (`verify: GET <url> expect "<text>"`) closes its item only when that line passes against production and, where the host reports versions, only
   after the live version changed; a probe still red after its retries, or an unchanged version, rolls the deploy back and puts the item back in
   the queue.
7. Learn: each prediction is graded against the metric it named when it falls due (`score_predictions`), and the `goals` step moves at most one
   bounded knob one step toward its target, reviews the move after `review_h` and reverts it when the goal did not move (`worker/src/goals.js`).

## 9. How it becomes autonomous: the ignition ladder

The system reads its own stage from its own tables each tick (`worker/src/ignition.js`); nothing is declared, and the first unmet stage is filed as
`IGNITE-<stage>`:

- `unseeded`: the schema is missing.
- `seeded`: the schema exists and a role can take work.
- `ticking`: the heartbeat completes every step, slot after slot.
- `looping`: every loop ticks and a second producer watches the heartbeat.
- `closing`: items close with independently verified outcomes and no silent drop.
- `instrumented`: every objective has a probe-backed target. The system is bootstrapped from here.
- `critical`: k_eff stays at or above its floor.
- `self-sustaining`: critical for a sustained run with no open ignition gap and no human touch.

## 10. How it achieves criticality

Criticality is a number the criticality step computes from the system's own tables (`worker/src/criticality.js`, thresholds in
`autonomy/criticality.json`): `k_eff = (credited verified deploys + credited loop-originated items) / (spend_units + human_touches)` over the window.
A deploy counts only when a probe the changing loop did not write verified it, and the credit for loop-originated items is capped so filing noise
cannot raise it. `k_self` counts only the verified deploys whose recorded origin is one the system ships on itself; a deploy an outside session drove
raises `k_eff`, not `k_self`. Three readings use the word self-sustaining, and each is its own number:

- the regime `self_regime`: `subcritical` (k_eff under k_min), `driven` (k_eff at or above k_min with k_self under it: outside work keeps it
  critical) or `self-sustaining` (k_self at or above k_min);
- the flag `self_sustaining` in the criticality snapshot: k_eff at or above k_min with no open ignition gap;
- the ignition stage `self-sustaining` above: critical for `sustained_ticks` in a row with no open ignition gap and no human touch.

When k_eff is under k_min, or a tick would end idle, the step originates the highest-value item at the head of the queue in the order
`autonomy/criticality.json` gives (a cost cut first when spend is over budget). The mantra, as code: ship, verify, spend less than it earns, feed
the next loop.

Platform: the core's own reading is `foundation/criticality.py` with `doctrine/criticality.json`: k = verified deploys in the window / (normalized
cost + human touches), and its regime is `self-sustaining` only when k_self is at the floor and the bootstrap fixed point holds; while it is `driven`,
the executor takes work that raises k_self first.

## 11. How it stays this way

`scripts/system.py --check` runs in the kit's own test suite (`tests/test_system.py`). It fails when the generated `SYSTEM.md` is stale, a clause's
probe or named test is gone, a path this text names outside a "Platform:" paragraph is missing from the kit, or the criticality formula here is not
the one in `autonomy/criticality.json`; `scripts/system.py --run-tests` runs every test a clause names. Formats are open standards: JSON with JSON
Schema for contracts, AGENTS.md and CLAUDE.md for agent instructions, cron for clocks.

Platform: `python3 -m foundation coldstart --check` runs in `checks` on every change. It fails when the seed stops carrying a capability, when this
text and its seed copy differ or stop naming a capability, stage or regime, when a public path of the contract is hidden, when an instruction names a
command that does not exist, or when the platform and seed agent files disagree. `coldstart --live URL` probes a deployed system; the seed launch
runs it on every fresh seed.
