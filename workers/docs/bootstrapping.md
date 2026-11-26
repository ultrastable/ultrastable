# Bootstrapping: idea in, organization out

Goal: a person has an idea. Everything else starts from it, server-side, without that person operating anything.

## The chain

```
IDEA.md ─► read ─► detect ─► select ─► cases ─► plan ─► write ─► surfaces ─► org ─► scaffold ─► ladder ─► provision ─► start
 (human)   (seed)  creds,    model     routes   roles,  org/     routes      org     CI and      which     D1, Worker   first tick
                   tools     tier      round    backlog files    health      plan    cycle       Cloudflare deploy      armed
                                       blockers gates                                  workflows   route
```

After `start`, the Worker's clock fires `runTick` every 10 minutes: a cron trigger, or on an account that refuses or never fires cron triggers a Durable Object alarm (`adapters/cloudflare/src/heartbeat.js`, rung 3 of [BOOTSTRAP-LADDER.md](BOOTSTRAP-LADDER.md)). Managers and staff are role rows in D1 with a model and a tick interval; each tick claims and dispatches items. Nothing needs a laptop.

The platform's own seed kernel (`seed/bootstrap/bootstrap.py` in the monorepo) runs fifteen stages: it adds `constitute`, `qualify` (refuses an idea that fails the system test before anything is staffed), `instrument` (objectives and metrics), `year_gate` (a simulated year of faults) and `verify_live` and has no `scaffold` or `ladder`. This repository's bootstrapper is the extracted reference; every stage below is its own.

## Stages

| Stage | Input | Output | If it fails |
|---|---|---|---|
| read | `IDEA.md`, `ultrastable.json`, `autonomy/policy.json` | parsed idea; policy validated (`validate_policy`) before the idea is considered | missing IDEA.md: degrade to an empty charter and open a gate card; invalid policy: block, with or without an idea |
| detect | environment | which connector secrets are set (never their values), which tools exist | each missing secret becomes a gate card with an `env:NAME` closing probe and a plain-words line |
| select | budget in IDEA.md | model for doer, reviewer, manager; the reviewer from a different model family than the doer when the budget allows two | budget 0 uses the smallest tier and says that doer and reviewer share a family |
| cases | the facts the idea and environment state | routes round each known blocker from `bootstrap/cases.json`, at most one owner card per blocker, in `org/bootstrap-cases.json` | |
| plan | the above | role instances (one project manager and product manager per outcome), kit backlog `KIT-0..KIT-5` and `KIT-7` (and `KIT-6` when the idea says nothing may be public), outcome items `OUT-n`, predictions | |
| write | plan | `org/` files including the owner `README.md`, `adapters/cloudflare/wrangler.jsonc`, `adapters/cloudflare/src/config.js`, `org/seed.sql` | |
| surfaces | the machine | which routes work (disk, git, `gh`, org token, Cloudflare token), recorded | never fatal |
| org | the code-host organization named by the idea or config | the plan to create and set up its repositories; applied only with an organization token | a card, never a stop |
| scaffold | the idea's repositories, runtime and cycle command | CI and cycle workflows for each repository | |
| ladder | the machine's Cloudflare sign-in | the first working route: connect, temporary account, scoped token, with every refusal recorded in `org/ladder.json` | one plain-words card when no route works |
| provision | `--apply` and a route | D1 created or found, migrations applied, seed SQL executed, Worker deployed (alarm tick when cron is refused) | blocked: a backlog item `BOOT-PROVISION` with the exact error |
| start | | the clock armed | KIT-3 closes only when six complete ticks are seen in an hour |

The same command is safe to run repeatedly: seed rows use `INSERT OR IGNORE`, D1 creation looks for an existing database first. A card added after the seed was written (the ladder card, the organization card) is written to `org/gate-cards.json` and `org/seed.sql` together. `--temporary` targets a temporary Cloudflare account (no cron, the alarm heartbeat, no database id).

## The tick (what the server does forever)

`reconcile` (disposition for every closed item, triggers become ready), `reap_claims`, `probe_gates` (owner-step cards close themselves when their probe passes), `score_predictions`, `accrue_trust`, `dispatch`, `execute` (a dispatched item whose closing probe the tick can read ends done with evidence or parked on that probe, and a parked item closes by itself when the probe passes), `check_plus_share`. A failing step is recorded and filed as work; the other steps still run. Each tick writes a four-line report to `tick_runs` and `/health`.

## Autonomy

Everything an agent may do is in `autonomy/policy.json`:

- **Surfaces** (repo, runtime, work tracker, internal chat, outreach, DNS, money, legal, secrets), each with a `max_permission` ceiling (`none`, `propose`, `execute`) and a `start_rung`.
- **Actions** per surface, each marked `reversible` and `identity_bound`. Irreversible but not identity-bound actions need a `reversible_path` (for example export to R2 before a destructive migration) or are denied.
- **The interrupt gate**: stop only for irreversible and identity-bound actions. Everything else runs and is verified.
- **Trust ladder**: observed, assisted, delegated, autonomous, self-directed, self-modifying, self-extending. Reliability per (surface, action class) = (verified + 0.5 x 2) / (outcomes + 2). With at least 10 outcomes, reliability 0.8 or more and no severe failure, `accrue_trust` opens a promotion item. Any hidden failure or silent drop demotes. A rung moves only when a different agent merges the PR changing the policy; the ledger never edits the policy itself. The rung can never exceed the surface ceiling, so money, legal, outreach and secrets stay below `execute` however trusted the fleet becomes.
- **Standing limits** that outrank trust: harness permission checks, safety refusals, the secret lock, outreach consent and opt-outs, the owner's override, other agents' live claims.

"Maximum permissions" means: allow everything a surface permits at its ceiling and deny only what the gate holds. `.claude/settings.json` does this for Claude Code (broad allow, deny list for force-push, repo deletion, `wrangler` deletes and secret writes). A server runner in an isolated container may run with permission prompts off; the deny list and the policy still apply, and `tests/test_policy.py` fails if a gated shell action lacks its deny rule.

## Agent instructions

`agents/AGENTS.md` is the single protocol; `CLAUDE.md` and `.github/copilot-instructions.md` point to it, so every agent family reads the same rules. `agents/roles/*.md` are the six role files. A role file changes only by reviewed PR, proposed by the operations role when a failure pattern repeats three times in seven days.

## Extending

Add a role: a file in `agents/roles/`, an entry in `ultrastable.json`, a PR. Add a surface: an entry in `autonomy/policy.json` with ceilings and actions, a PR. Other runtimes (GCP Cloud Run + Scheduler + Firestore, AWS, self-hosted) reimplement `provision` and `start`; the tick logic, schema and policy are runtime-neutral.

## What is built, and what is not done yet

- Model calls: built in `core/runner`: it takes an item to a draft pull request with a doer and a reviewer from different model families, never merges, and is off until enabled (`runner.enabled`).
- Repository creation and protection: built in the platform host (`seed/worker/src/apprepos.js` in the monorepo, which creates a system's repository from the template with the host's own GitHub App); this repository's bootstrapper plans it in the `org` stage and lists the credential as a card.
- A real `--apply` against a Cloudflare account: run once on 2026-11-12 on a reference account with throwaway resources, ending in a verified organization ticking from the alarm heartbeat (`org/bootstrap-live-trial.json`). Still open: a separate fresh account with no help, cron-mode ticking (the cron registered and never fired in that trial), and the `--temporary` path on a real temporary account.
