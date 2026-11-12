# Vision: what Ultrastable is for, and what it is not for

> Ultrastable is the foundation for any autonomous system.

Every agent, role and bootstrap reads this first. It is the answer to "what is this actually for?", and it is enforced in code
(`seed/bootstrap/bootstrap.py` stage `qualify`, tested by `tests/test_vision.py`), not left as prose.

## What it is for

Ultrastable runs **systems**: bodies of ongoing work that must keep running, measuring themselves and correcting themselves after the
person who started them has stopped paying attention. A system is autonomous if it has self-referential loops and the ability to close them.
Coding agents write code. Ultrastable decides what to work on next, hands it to an agent, proves the result live, reverts what regresses and
keeps score of how often it was right.

Systems it is built for (each one is a fleet of roles, not a page):
- a service fleet that finds its own failures and fixes them, with probes and automatic revert;
- a research or publishing operation whose findings, editions and citations stay current;
- a compliance, security or cost program that watches an environment and closes what it finds;
- a data pipeline that notices drift, repairs itself and logs why;
- a portfolio of software projects where agents triage and ship and a few human gates remain;
- a growth, support or evaluation operation that tests, measures and keeps only what works.

## The system test (all four must hold, or it is not a fit)

1. **A loop it must close.** Something is observed, acted on and observed again, repeatedly, with no person in the middle.
2. **A measure that can be wrong.** A named metric or probe that can breach, and a prediction logged before each change and scored after.
3. **Upkeep that never ends.** Work that keeps arriving (failures, drift, new sources, new rules). A finished deliverable is not a system.
4. **A running cost the owner accepts.** The back end (compute, model calls, storage) costs money every month. A stated monthly budget is part of the idea.

## What it is not for

A one-off page, an app you build once and forget, a trip, a weekend project, a hobby tool, a personal reminder, prompt-by-prompt "vibe coding".
Those need a site builder or a chat assistant. Starting a project manager, a portfolio manager and a team of agents for them is a defect: the
cost of the organization would exceed the value of the thing. When an idea fails the system test, the right output is a plain "this is not a
fit, here is what to use instead", never a smaller staffing of the same machinery.

## Proportion rule

Staffing follows the system, not the other way around. Roles, projects and managers are created only for outcomes that pass the system test.
Setup and commitment are expected: this is not zero-effort. The zero-fuss part is the owner's side (no code, no terminal, voice is enough);
the commitment is stating the loop, the measure, the upkeep and the budget.

## Where this is enforced

| Place | How |
|---|---|
| `CLAUDE.md`, `seed/CLAUDE.md` | import this file, so every agent session starts from it |
| `docs/BOOTSTRAP-PROMPT.md` section 0 | the bootstrap qualifies the idea before it initializes anything |
| `seed/IDEA.md` | the founder's one file carries a `# System test` section |
| `seed/bootstrap/bootstrap.py` | stage `qualify` stops the boot with a not-a-fit card before any role is hired or anything is provisioned |
| `tests/test_vision.py` | fails the build if any of the above drifts |
| Site front door | headline, hint, suggestions and the "What it is not for" section say the same thing |

## Known drift (owner: product-manager; closing probe: `tests/test_vision.py`)

- The public front door's BUILD-1 path still produces a single self-contained page from an idea. That is a demo of the interview, not the
  product. It must route ideas through the system test before building (gap Q-GAP-front-door-qualify).
