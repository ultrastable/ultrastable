# 00 Scope and boundaries

## Purpose
Keep Ultrastable one thing. Strategy of 2026-11-11 (Rowan): Ultrastable is a **code base** that a person who cannot code can bootstrap into a fully working system, starting from nothing but a statement of what they want. It is released source-available under the hybrid license: free for non-commercial use, licensed for commercial use.

## What it is
1. An integrated ecosystem of virtual managers, virtual staff, loops and records, run from a heartbeat, that turns an idea into a running organization or software system.
2. A **bootstrapper** that writes what the person does not know to ask for: architectural specifications, charters, work breakdown, roles and backlog (spec 08).
3. A **guided interface** between a bare search box and a command line: bite-sized screens, buttons and prompts (spec 09).
4. A **portable core** with thin cloud adapters. First code base: JavaScript on Cloudflare Workers. Second embodiment: Google Cloud. Any platform that supplies a store and a scheduler can run it (spec 01).
5. A **project-management engine** that bakes in portfolio, program, product and project practice, agile and traditional (spec 10).

## What it is not (hard boundaries, default off)
By default Ultrastable does **not** write your business plan, patent, legal filing, financial model or marketing campaign. Code can do all of those, and the QNFO fleet shows it, but they are **extensions** (opt-in kits, outside the core) and QNFO is a demonstration, not the product. What the bootstrap does write by default is architectural specifications, charters and the work plan for the system the person asked for.

| Rule | Check |
|---|---|
| The core contains no domain content (no business-plan, patent, research, outreach logic) | `core-manifest/boundary.json` classes; a core file must not import an extension |
| Extensions live apart from the core and are listed in `specs/00-scope.md` §Extensions | `scripts/check_license.py` verifies the split manifest |
| A new default behavior needs a scope PR to this file, reviewed, plus the owner's approval | CODEOWNERS on `specs/00-scope.md` |
| Features are added to serve a person who knows what they want and not what to ask for; features that only help an engineer are tools, not core | review checklist |
| Nothing is integrated for its own sake: the system says no to being a Squarespace, an IDE or a command-line agent | scope PR required to reverse |

## Audience
A person who can state an outcome, has no software training and does not know what they do not know. They never need to write code or look under the hood: the front end is the back end. A code agent MAY use the same back end through an API, but this is not the target user.

## Extensions (opt-in, outside the core)
Business-plan, patent drafting, funding and outreach, research publication, social, personal companion. They exist in the repository as demonstrations from QNFO and the first Ultrastable instance. Moving them out of the default seed is tracked in [docs/handoff/license-and-specs.md](../docs/handoff/license-and-specs.md).

## Scope-creep guard
Every issue and PR names which numbered spec it serves. Work not tied to a spec is filed as a proposal, not built. Plussing (spec 05) MUST improve existing specified behavior and MUST NOT add a new product category.

## Status
Spec: BUILT as text. Enforcement: boundary class check exists for QNFO workers; a core-must-not-import-extension check is PLANNED.
