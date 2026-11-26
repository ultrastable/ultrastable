---
consumer: doctrine/decision-ledger.json
---
# DISCLOSE-1: what is public, what is private, and what each repository holds

Owner directive (Rowan, 2026-11-26): the full specification should live in the specification repository and need not be public; show the
working product, keep the design know-how; no patent, so the specification must not be "up for grabs"; the template repository carries
only what a new instance needs to deploy, and everything else lives in another repository, public or not.

## The line

| Tier | What | Where |
|---|---|---|
| Public | Running code (seed kernel, `workers/`, `foundation/`, `site/`), the public contracts (`/.well-known/ultrastable.json`, OpenAPI, `/claims.json`), the definition and scope (`VISION.md`, `SYSTEM.md`, `SCOPE.md`), white papers with measured results, requirement IDs, conformance level names and pass/fail counts, one-line synopsis per specification | `ultrastable/ultrastable`, `ultrastable/seed`, tenants, `.github` |
| Private | The full specification text (requirements, rationale, failure-mode catalogue, deviations with reasons), the long-form rule narrative, company IP, legal, business and funding papers | `ultrastable/ops` (`spec/`, `admin/`), no workflow, so nothing is billed |
| Never in any repository | Secrets and credentials | Worker bindings only |

## Repository map

| Repository | Visibility | Holds | A new instance reads it? |
|---|---|---|---|
| `ultrastable/seed` | public | Only what a new instance needs to deploy and run: `bootstrap/`, `worker/`, the kit's `scripts/`, `autonomy/` defaults, `agents/` operating agreement, generated `SYSTEM.md` | yes, this is the template |
| `ultrastable/ultrastable` | public | The working platform: `foundation/`, `site/`, `dashboard/`, `workers/`, `deploy/`, doctrine data the loops read, white papers, public docs | no |
| `ultrastable/ops` `spec/` | private | The full specification, `US-SPEC-00` onward | no |
| `ultrastable/ops` `admin/` | private | IP, legal, business, funding | no |
| `ultrastable/spec`, `ultrastable/workers`, `ultrastable/license` | public, archived | Retired redirects; their content lives in the platform | no |

A dedicated specification repository is a `git mv` away from `ops/spec/`. `ultrastable/spec` is archived (GitHub refuses pushes) and
unarchiving or creating a repository is an organization-admin act with no tool in this session's scope, so the default in effect is
`ultrastable/ops` `spec/`. Probe: `ultrastable/ops` is private and holds no workflow (`python3 -m foundation repostd --check`).

## What already happened cannot be undone

The specification has been public in `ultrastable/ultrastable` (`specs/`, and the archived `ultrastable/spec`) with its full history.
Removing it from `main` does not remove it from history, forks, clones or caches. A history rewrite is not taken: the repository's ruleset
refuses force pushes and deletion, and lifting it is an organization-owner act on unbacked data. What is already out is treated as out;
what is written from here on is protected. The only protection chosen for the work is the Ultrastable License (no patent, decision of
2026-11-17), and trade-secret protection depends on reasonable secrecy measures going forward; counsel confirms the legal effect.

## Sequence

1. Workflow `wf_63903503-466` finishes (specs brought level with the code, new specs 26 onward, requirements built and tested).
2. The new and changed specification files are exported to `ultrastable/ops` `spec/` on branch `ccr-00cc0f5d-kgqx6s` and a draft PR opened
   there. **They are never committed to the public branch**: `specs/US-SPEC-*.md` changes and additions stay out of every public push.
3. The public branch carries code, tests and generated data only.
4. A second workflow: `doctrine/disclosure.json` and `foundation/disclosure.py` (the check), the specification tooling reading
   `ULTRASTABLE_SPEC_DIR` (full mode when the private specification is mounted, ID-registry mode in public CI), `specs/` in the public
   tree reduced to a synopsis `README.md`, fleet-map rows, and the seed slimmed to the operating agreement plus the generated rules index
   (its `agents/AGENTS.md` is 140 KB of platform design narrative that every new instance loads).

## Not changed here

`agents/AGENTS.md` in the platform stays whole: every repository fetches it by public raw URL at session start (AGENT-BOOTSTRAP-1).
