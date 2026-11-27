# Vision: what Ultrastable is for, and what it is not for

> Ultrastable is the foundation for any autonomous system.

Every agent, role and bootstrap reads this first. It is the answer to "what is this actually for?", and it is enforced in code
(`seed/bootstrap/bootstrap.py` stage `qualify`, tested by `tests/test_vision.py`), not left as prose.

## What it is for

The gap Ultrastable fills is **the development work after the first version**. Vibe coding produces a thin, static first draft and stops. A coding agent
does what it is told, so the owner must already know what to ask for. A person who starts with a bare skeleton of an idea does not know what to ask
for next. Ultrastable puts the managers behind the scenes (portfolio, program, product, project) that look at measurements, decide what to improve,
file the work, hand it to coding agents, prove the result live and keep score. The owner supplies direction and a budget; the system supplies the
backlog. That is the product: **autonomous, measured, continuous improvement of something that has to keep running.**

The owner can be an organization, a small business or one person. What qualifies an idea is the system test below, not who owns it and not whether it
earns money: it has to be something that keeps running, keeps needing work, and is worth a monthly cost to its owner. Examples:
- a club, association or small-business website that must keep growing (search ranking, content, performance, security patches, bookings, member
  features) instead of freezing after launch;
- a personal system one person depends on every day: a companion that remembers and follows up, a signals desk that watches markets or the
  news against the owner's own rules, a tracker whose sources and logic keep changing;
- a service fleet that finds its own failures and fixes them, with probes and automatic revert;
- a research or publishing operation whose findings, editions and citations stay current;
- a compliance, security or cost program that watches an environment and closes what it finds;
- a data pipeline that notices drift, repairs itself and logs why;
- a portfolio of software projects where agents triage and ship and a few human gates remain.

A site is not excluded by being a website. It is included when it is meant to be **run and improved**, not launched and forgotten.

## The system test (all four must hold, or it is not a fit)

1. **A loop it must close.** Something is observed (traffic, errors, failing probes, support requests), acted on and observed again, with no person in the middle.
2. **A measure that can be wrong.** A named metric or probe that can breach, and a prediction logged before each change and scored after.
3. **Upkeep and improvement that never end.** Work keeps arriving (failures, drift, new sources, new rules) and there is always a next improvement the managers can originate from the measures.
4. **A running cost the owner accepts.** The back end (compute, model calls, storage) costs money every month. A stated monthly budget is part of the idea.

## What it is not for

Selling things online. Storefronts, carts and checkout are served well by shop builders; Ultrastable does not compete there and does not pitch itself
on revenue. An owner's shop can sit beside a system Ultrastable runs, but the shop is not the system.

A single finished deliverable nobody will run again: a one-off page, an invitation, a trip plan, a weekend project, a personal reminder. Those
need a site builder or a chat assistant. Starting a portfolio manager, project managers and a team of agents for them is a defect: the cost of the
organization would exceed the value of the thing. When an idea fails the system test, the right output is a plain "this is not a fit, here is what
to use instead", never a smaller staffing of the same machinery.

## Objectives, metrics and probes: the meta-system (OBJECTIVES-1)

What the agents work toward, and how anyone can tell, differs for every system, so it is set up at bootstrap, not assumed. Same pattern the
QNFO fleet runs on (metric registry, trigger state, breach files its own remedy):
- Stage `instrument` writes `org/objectives.json` and seeds the `objectives` and `metrics` tables. One objective per first outcome. The owner's
  declared measure is recorded as a `declared` metric, which is a breach until a probe (builtin, sql or http) can read it.
- Every system gets the same liveness metrics, so "is the clock turning and are the loops closing" is a probe from minute one: tick heartbeat,
  acting (dispatches), closing (items done), verified (independent outcomes), no silent drops, and instrumented (every objective has a
  probe-backed target). Each has a grace period, then a silent clock breaches.
- The tick step `measure` reads every metric each cycle. A breach files `BREACH-<metric>` with an owner, done check and closing probe, and
  closes it when the probe passes. Product managers originate new target metrics and guards for their objective; that is how a bare skeleton
  gets improved without the owner knowing what to ask for.
- Kit items KIT-5 (instrumented) and KIT-6 (clock proof) are the bootstrap's own closing probes. Code: `seed/worker/migrations/0004_objectives.sql`,
  `seed/worker/src/tick.js`, `seed/bootstrap/bootstrap.py`, tests `seed/worker/test/measure.test.js`, `tests/test_vision.py`.

## Layers: turtles all the way down

There are at least two levels, and the structure is recursive. Level 0 is Ultrastable running on its own infrastructure (customer zero). Level 1 is a
system a customer builds on it. Level 2 is whatever that customer builds for its own users on top. The same bootstrap, system test, objectives and
probes apply at every level; nothing is special-cased. A child records its `parent` and `level` in its IDEA.md and gets an `M-parent-link` liveness
metric, so a child that goes silent breaches at the level above it. Data: `layers` in `doctrine/pilot-model.json`; code: `seed/bootstrap/bootstrap.py`;
tests: `tests/test_vision.py` (LayerTests). Tenancy: tenant 0 is Ultrastable on itself (the public demo); each customer system is a tenant of the same shape, the dashboard takes a tenant id, every metric row carries `tenant_id`, and a runtime measures only its own tenant, so one level's loops cannot change another's (`seed/worker/src/tick.js`, `Q-TENANT-row-isolation`). Multi-tenant hosting would be a separate obligation (`multi_tenant_obligations` there), not a pilot feature.

## Proportion rule

Staffing follows the system, not the other way around. Roles, projects and managers are created only for outcomes that pass the system test.
Setup and commitment are expected: this is not zero-effort. The zero-fuss part is the owner's side (no code, no terminal, voice is enough);
the commitment is stating the loop, the measure, the upkeep and the budget.

## Where this is enforced

| Place | How |
|---|---|
| `AGENTS.md`, `seed/AGENTS.md` | the entry file every agent session loads names this file for product and bootstrap work (AGENT-ENTRY-1) |
| `docs/BOOTSTRAP-PROMPT.md` section 0 | the bootstrap qualifies the idea before it initializes anything |
| `seed/IDEA.md` | the founder's one file carries a `# System test` section |
| `seed/bootstrap/bootstrap.py` | stage `qualify` stops the boot with a not-a-fit card before any role is hired or anything is provisioned |
| `tests/test_vision.py` | fails the build if any of the above drifts |
| Site front door | headline, hint, suggestions and the "What it is not for" section say the same thing |

## Known drift (owner: product-manager; closing probe: `tests/test_vision.py`, `site/site.test.mjs`)

- None open. The public front door refuses a definite one-off before anything is stored or built (`systemTest` in `site/worker.js`, HTTP 422 `not_a_fit`)
  and lets any maintained system through to the interview, which asks for the loop, the measure, the upkeep and the budget.
