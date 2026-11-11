# Repository split: code, specifications, operations

Decision 2026-11-11 (Rowan): the code base is separate from the documentation, the first code base is JavaScript on Cloudflare Workers, and the code is public-readable under the hybrid license, with no patent. The machine-readable plan is [repo-split.json](../repo-split.json); the tool is `scripts/split_repos.py`.

| Target repo | Role | Contents (from this monorepo) | After license review |
|---|---|---|---|
| `ultrastable/workers` | **code**, first code base | `seed/` (tick, schema, bootstrapper, roles, policy), `foundation/`, `dashboard/`, `site/`, `demos/`, `products/` (gaplint), `tests/`, `platform/cloudflare-reference/`, `deploy/` | public-readable, hybrid license |
| `ultrastable/portable` | code, second embodiment | `platform/core` (Python reference runtime), `platform/adapters` (Google Cloud, SQLite) | public-readable after `workers` |
| `ultrastable/specs` | **documentation** | `specs/`, concepts, bootstrapping guides, legal notes, architecture, open-core governance files, `external/` | public-readable, hybrid license |
| `ultrastable/ultrastable` | private operations hub | business, funding, outreach, social, memory, agents, scripts, CI, brand, research, archived patent drafts | stays private |

Every target carries `LICENSE`, `LICENSING.md`, `COMMERCIAL-LICENSING.md`, `NOTICE` and `CITATION.cff`.

## How the split runs
1. `python3 scripts/split_repos.py check` (in CI): every tracked file is assigned to exactly one target.
2. `python3 scripts/split_repos.py build --out ../split` writes the four trees. Longest path prefix wins.
3. Create the three new repositories in the org and push each tree: identity-bound for the org admin (`ORG_ADMIN_TOKEN`, [ops/ORG-TOKEN.md](ops/ORG-TOKEN.md)); default in effect: the monorepo stays canonical and nothing is split. Closing probe: `gh api repos/ultrastable/workers` returns the repository.
4. The old archived duplicate repos (`site`, `docs`, `platform`, `ip`, `business`, `seed`) are not reused; they cannot be pushed to while archived.
5. Visibility: all private. Publishing is an owner step after `repo-split.json` state becomes `reviewed` (counsel sign-off line in [legal/LICENSE-REVIEW.md](legal/LICENSE-REVIEW.md) and an entity in `LICENSE`).

## Where the code is today
All code is in this monorepo already: `seed/worker/` (Cloudflare Worker, D1 schema and tests), `platform/cloudflare-reference/` (16 verbatim QNFO workers files), `platform/core/` (Python reference runtime), `dashboard/`, `site/`. The much larger QNFO fleet lives in `QNFO/qnfo-workers` (public, QNFO license); extracting more of it into `workers` follows the boundary in `core-manifest/boundary.json`.

## Not done here (tracked in docs/handoff/license-and-specs.md)
Moving extension content (business, patent, funding, outreach logic) out of the default seed; the `core must not import extension` check; per-target CI.
