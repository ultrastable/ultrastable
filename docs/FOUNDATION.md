# Foundation architecture

**Ultrastable is the foundation for any autonomous system.** A business, a research programme, an open-source project, a community or something new is created from one instance manifest. Nothing else differs between systems.

Status words used here: RUNNING, BUILT, PLANNED. No financial claims. Ultrastable is a separate brand from QNFO.

## Three layers

| Layer | Where | What it holds | Changes by |
|---|---|---|---|
| 0 kernel | `seed/` | doctrine in `agents/AGENTS.md`, role files, `autonomy/policy.json`, the bootstrap case library (`bootstrap/cases.json`), the tick worker and D1 schema | reviewed PR only |
| 1 foundation | `foundation/` | manifest validation, the `new-system` generator, credential ladder, preflight, filing-route planner, minute-budget guard, owner-step routes | reviewed PR only |
| 2 instance | `instances/<slug>/instance.json` | name, brand, goals, positioning, funding routes, owner jurisdiction, runtime, disclosure gate, budget | the owner or the fleet, by PR |

The generator copies the kernel unchanged and writes the instance values around it, so improving the kernel improves every system on its next generation.

## The instance manifest

Required: `name`, `slug`, `kind`, at least one goal. Everything else has a default (`foundation/manifest.py`). The validator refuses secret-shaped strings and e-mail addresses: secrets and contacts are referenced by binding name only (`owner.contact_binding`). The disclosure gate cannot be opened while a filing gate is closed.

## new-system

```
python3 -m foundation validate   --manifest instances/<slug>/instance.json
python3 -m foundation new-system --manifest instances/<slug>/instance.json --out ../<slug>
```

Output (BUILT, tested end to end in CI): `IDEA.md`, `ultrastable.json`, `instance.json`, kernel files, `docs/PROJECT-MEMORY.md` (memory in the repo), one PR-only `checks.yml`, `gaplint.json`, and under `org/`: `bootstrap-cases.json`, `preflight.json`, `owner-steps.json`, `OWNER-CARD.md`, `filing-plan.json` and friends, `foundation-report.json` and `failures.json`. A step that throws is written to `failures.json` as a backlog item with a closing probe; the generator never stops and never swallows an error. Running it twice changes nothing.

## Self-bootstrap contract

1. **Preflight** (`foundation/preflight.py`): disk, tools and credential state recorded, never fatal.
2. **Credential ladder** (`foundation/ladder.py`, routes in `data/credential-routes.json`): every route is tried in order, every outcome including denials is recorded, a refusal is never re-routed around, and at most one identity-bound card opens per credential, only when every route failed. Only whether a binding exists is read, never a value.
3. **Owner-step engine** (`foundation/ownersteps.py`, chains in `data/owner-steps.json`): each owner-only step is detect, attempt, fall back, then one card. Statuses: done, automated, prepared (autonomous work finished, one card open), degraded (not identity-bound, so a backlog item and never a card).
4. **Cases** (`seed/bootstrap/cases.py`): starting conditions become routes; facts come from the manifest.
5. **Filing-route planner** (`foundation/filing.py`, `data/jurisdictions.json`): keyed on the owner's domicile; unknown countries get a research route, never a route chosen from memory; ends in one sign-and-pay card.
6. **Minute guard** (`foundation/minutes.py`): every generated workflow carries budget, trigger and free-alternative comments, a timeout, no matrix, no schedule above weekly; the kill switch is `actions-budget.json`.
7. **Funding, outreach, social, site and demos** run through the seed loops (`seed/funding`, `seed/outreach`, `social/`), all dry-run until their credentials and gates pass.

## What is autonomous and what is not (2026-11-10)

| Owner step | Autonomous route in code | Remaining identity-bound act |
|---|---|---|
| File the priority application | portal probe, jurisdiction plan, filing set preflight | sign and pay |
| Legal entity | individual-eligible routes proceed, entity-only routes deferred with the reason | form the entity |
| Org admin credential | env, device login scope, GitHub App routes | mint it when no route holds it |
| Cloudflare credentials | env, wrangler login, cf login routes | mint it when no route holds it |
| Brand UI items | assets and checklist prepared | the upload clicks (no API exists) |
| Social accounts | account-free channels carry the work, posts queued | create the accounts |
| Funding applications | packets drafted and guarded, one card lists them | submit as the owner |
| Outreach sender | dry-run queue, sender route probes | register the mailbox |
| Domain e-mail alias | Cloudflare Email Routing call (fixture-tested, `--apply`) | none |

The engine never gets past a permission check, never impersonates the owner and never handles a secret value.

## Instances

- `instances/ultrastable/`: Ultrastable running itself.
- `instances/qnfo/`: QNFO as an instance; adoption path and closing probe in its README.

## Doctrine is code

`doctrine/positioning.json` is the source of truth for the positioning line and for the rule "Code is the only memory". Nothing in prose is authoritative.

- `python3 -m foundation doctrine --apply` injects the line into the markdown files the doctrine lists; `--check` fails on a missing line, a contradiction, a missing memory rule, a reliance on chat, tool or platform memory, or a missing `docs/PROJECT-MEMORY.md`. `checks.yml` runs `--check` on every PR.
- gaplint rules GL008 (positioning) and GL009 (memory in code) read the same file.
- `foundation.TAGLINE` is read from it, and the generator copies the file into every instance and writes the line into its README, agent files and memory.
- The only memory is the repository: `docs/PROJECT-MEMORY.md` and data files. Tool and chat memory hold a pointer at most.
