<!-- generated-by: scripts/system.py from doctrine/system.json (SYSTEM-1). Edit the JSON, then run --gen --apply. -->
# What an Ultrastable system is

> Ultrastable is the foundation for any autonomous system.

An Ultrastable system is an ongoing system that runs itself on server-side infrastructure: it observes, acts, verifies and improves through closed loops with no person in the path, keeps its essential variables inside their limits, and changes its own rules when they drift out (Ashby's two loops). The owner gives an idea and a budget. The system does the rest, from repository to live front end, and gets measurably better on its own.

## What it is

- **system-test.** It is a system, not a one-off: a loop it closes, a measure that can be wrong, upkeep that never ends, a running cost the owner accepts. An idea that fails this is told it is not a fit. Code: `bootstrap/bootstrap.py`, `doctrine/VISION.md`. Proof: python3 bootstrap/bootstrap.py --dry-run (stage qualify).
- **public.** Public by default: repository, front end and information are public unless an asset is marked private with a reason. Secrets never. Code: `worker/src/discover.js`, `worker/src/visibility.js`. Proof: GET /.well-known/ultrastable.json answers 200.
- **own-repo.** It lives in its own repository and runs as a sandboxed tenant: its worker binds only its own stores. Code: `worker/src/apprepos.js`, `worker/src/tenant.js`. Proof: python3 -m foundation tenantrepos --isolation (platform).
- **full-stack.** It deploys itself in full: repository, back end and a public web front end. Code: `worker/src/index.js`, `worker/src/visibility.js`, `worker/wrangler.template.jsonc`. Proof: GET / answers 200 with the public page.
- **honest-numbers.** Every number and claim it publishes traces to a live query or a cited source. An unsourced number is blocked, never estimated. Code: `scripts/claims.py`, `doctrine/claims.json`. Proof: python3 scripts/claims.py --check.
- **human-voice.** Everything written for people reads like a person wrote it: plain words, short, specific, no buzzword lists or stock openers. Code: `scripts/humanvoice.py`. Proof: python3 scripts/humanvoice.py --check.

## How it runs

- **tick.** A heartbeat (the tick Worker's cron, every 10 minutes) reconciles state, dispatches work, verifies, scores predictions and records every step. Code: `worker/src/tick.js`, `worker/src/pulse.js`. Proof: /health answers 200 after the first complete tick.
- **managers.** Virtual managers (portfolio, program, product, project) and staff take work from one queue; a reviewer that is never the author verifies it. Code: `agents/roles/portfolio-manager.md`, `agents/roles/product-manager.md`, `agents/roles/project-manager.md`, `agents/roles/reviewer.md`, `ultrastable.json`. Proof: org/roles.json lists every manager after bootstrap.
- **first-loop.** First loop: every objective has metrics with limits; a breach files its own item with an owner, a trigger and a closing probe. Code: `worker/src/tick.js`, `worker/migrations`. Proof: BREACH-<metric> items open and close on the metric's own reading.
- **second-loop.** Second loop: when an essential variable stays out of bounds the system changes its own parameters (goals and knobs), predicts the effect, and keeps or reverts the change. Code: `worker/src/goals.js`, `autonomy/goals.json`, `worker/src/critloop.js`. Proof: goal.* rows in the audit log.
- **decisions.** Every decision logs the metric it serves and a prediction, and is scored against what happened. Code: `worker/src/decisions.js`. Proof: /api/decisions shows scored outcomes.
- **flow-balance.** Issue inflow never exceeds closures and every item closes inside its SLA; nothing sits in the queue. Code: `scripts/balance.py`, `autonomy/balance.json`. Proof: python3 scripts/balance.py --probe.
- **red-team.** It questions what it does not know (inversion, pre-mortem, red team) and files what it finds. Code: `worker/src/unknowns.js`. Proof: UNK-* items filed from its own daily reserve.
- **research-to-code.** Research becomes code: findings become items whose closing probe is the measurement; white papers carry only measured numbers. Code: `scripts/improve.py`, `autonomy/improve.json`. Proof: python3 scripts/improve.py --check.
- **knowledge-graph.** It keeps a knowledge graph of all its own data, built and maintained with no configuration. Code: `worker/src/datagraph.js`, `worker/migrations/0031_datagraph.sql`. Proof: GET /api/graph answers 200.
- **discoverable.** It serves its manifest, a 'Built on Ultrastable' footer and a daily heartbeat to the directory, and promotes itself and its siblings. Code: `worker/src/discover.js`, `worker/src/promoqueue.js`, `worker/src/social.js`. Proof: the directory lists it after reading its manifest.
- **sticky.** It keeps fresh content with breadth and depth so people come back, and shows visible progress at every visit. Code: `worker/src/stickiness.js`, `worker/src/progress.js`. Proof: /api/stickiness and /progress.json.
- **budget.** It stays inside its budget with a soft throttle: non-essential steps wait as spend rises, the clock never stops. Code: `worker/src/spend.js`, `worker/src/freetier.js`, `autonomy/cost-budgets.json`. Proof: tick notes show the spend level each pass.
- **halt.** One halt stops every recurring path; pages keep serving. Code: `worker/src/budget.js`. Proof: HALT=1 stops the tick and every workflow job.

## How it bootstraps from zero

- **idea.** The owner writes one file, IDEA.md, or types the idea at the front door. That is the only human input. Code: `IDEA.md`, `bootstrap/bootstrap.py`. Proof: bootstrap stage read ok.
- **boot-stages.** The bootstrap reads, qualifies, instruments, plans, writes the org, provisions D1 and the Worker, starts the clock, passes the year gate and probes the live URL. Code: `bootstrap/bootstrap.py`. Proof: org/boot-log.json has no blocked stage.
- **credentials.** Credentials come through the host or a consent screen and are stored, refreshed and probed by the Worker. No person pastes a token. A hosted system asks its owner for no secret. Code: `worker/src/auth/consent.js`, `worker/src/auth/github-app.js`, `worker/src/apprepos.js`. Proof: a hosted boot opens no card asking for a secret (clean room no-human-steps).
- **repo-settings.** Its repository sets its own settings and rulesets: delete branch on merge, auto-merge on, no force-push; no branch outlives its pull request. Code: `worker/src/auth/rulesets.js`, `scripts/branch_cleanup.py`, `.github/workflows/branch-cleanup.yml`. Proof: python3 scripts/branch_cleanup.py --check.
- **workflows.** Every workflow declares its minute budget, trigger and free alternative, has a timeout and honours HALT. Code: `.github/workflows`. Proof: clean room workflows capability.
- **year-gate.** Every fault an unattended year brings has a drill that runs the real recovery code; the boot passes only when the simulated horizon reaches 365 days. Code: `scripts/yearsim.py`, `autonomy/yearsim.json`. Proof: bootstrap stage year_gate ok.

## How it becomes autonomous

- **merge-lane.** A green pull request merges itself; a conflicted one is reconciled with main; every merge deploys what it touched and is probed live. Code: `worker/src/lane.js`, `worker/src/lanemerge.js`, `worker/src/handoff.js`. Proof: open_prs trends to 0 with 0 human touches.
- **executor.** The system codes its own changes from its queue; code agents in chat sessions are outside input and never count. Code: `worker/src/executor.js`, `worker/src/doer.js`, `worker/src/codeagent.js`. Proof: self_deploys rises (origin executor or self-agent).
- **self-improve.** It files its own reach, impact, front-end and back-end improvements every pass and settles each on its metric. Code: `scripts/improve.py`, `.github/workflows/improve.yml`. Proof: a quiet changelog is a defect filed by the next pass.
- **two-way-sync.** It pulls the platform kernel down weekly and lifts its own general code up to the platform, so one fix improves every system. Code: `.github/workflows/platform-sync.yml`. Proof: days behind the platform stay under 14.
- **no-human-wait.** Nothing waits on a person. Only an act that is irreversible and identity-bound (money, signature, the owner's own account) becomes one gate with a default in effect. Code: `autonomy/policy.json`, `bootstrap/cases.json`. Proof: human_wait_states = 0.

## What criticality means

- **ignition.** The stage is computed from evidence, never declared: seeded, ticking, looping, closing, instrumented (bootstrapped), critical, self-sustaining. /health carries the stage and what blocks the next one. Code: `worker/src/ignition.js`. Proof: GET /health shows the ignition stage.
- **k.** k_eff = verified deploys / (normalized cost + human touches). Critical: k_eff >= k_min (autonomy/criticality.json) for min_streak ticks. Self-sustaining: critical for sustained_ticks with 0 open ignition gaps and 0 human touches, counting only deploys the system originated itself (k_self). Code: `worker/src/criticality.js`, `autonomy/criticality.json`. Proof: criticality_samples rows; k_self >= k_min.
- **unattended.** The target is a year unattended: the 10th-percentile simulated horizon is at least 365 days and every external input is closed, a gate with a default, or an open item. Code: `scripts/yearsim.py`, `autonomy/goals.json`. Proof: goal core.year.unattended met.
