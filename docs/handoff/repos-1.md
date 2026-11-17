---
consumer: foundation/writeback.py
---
# REPOS-1: fewer repositories (2026-11-17)

> Ultrastable is the foundation for any autonomous system.

Session: session_0156nqDvjKMRKDZZN7ARH5mX

The repository list is now one manifest (`brand/brand.json`: `structure`, `status`, `holds`, `tenants`). `python3 brand/tools/sync_repos.py` generates the README section "How Ultrastable is organized" and `site/orgmap.js` (the /how page); `--check` fails on drift. `seed` and `license` are retired pointers; the criticality mirror moved to `metrics/criticality.json`. Open: Q-REPOS-MERGE-WORKERS, Q-REPOS-MERGE-SPEC (reconcile diverged copies), Q-REPOS-ADMIN-APPLY (archive writes need an admin route).

## Spec folded in (Session: session_0156nqDvjKMRKDZZN7ARH5mX)
The spec repository moved here (`specs/`, `SCOPE.md`, `licensing/`, `docs/spec/`) and is a retired pointer. Open: Q-REPOS-MERGE-WORKERS, Q-REPOS-ADMIN-APPLY (archive + admin link).

## Workers folded in (Session: session_0156nqDvjKMRKDZZN7ARH5mX)
The workers repository moved here as `workers/` with its standalone layout (its tests pass in place: `cd workers && npm test`). `workers/.github/workflows` is inert (Actions reads only the root). Open: Q-REPOS-ADMIN-APPLY (archive writes), instance pins of `ultrastable/workers` tags (upstream.py runtime_core) keep resolving while the archived repo stays readable.

## Archive step (Q-REPOS-ADMIN-APPLY)
Session: session_0156nqDvjKMRKDZZN7ARH5mX

`/connect/github-admin` registers an administration-only GitHub App; finishing its install runs `archiveRetired` (`seed/worker/src/auth/archive.js`), which archives seed, license, spec and workers (list mirrors `brand/brand.json`, tested). A failed archive is recorded as a credential event and the page still completes. Q-REPOS-ADMIN-APPLY closes when the four repositories show archived.
