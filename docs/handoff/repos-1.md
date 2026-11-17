---
consumer: foundation/writeback.py
---
# REPOS-1: fewer repositories (2026-11-17)

> Ultrastable is the foundation for any autonomous system.

Session: session_0156nqDvjKMRKDZZN7ARH5mX

The repository list is now one manifest (`brand/brand.json`: `structure`, `status`, `holds`, `tenants`). `python3 brand/tools/sync_repos.py` generates the README section "How Ultrastable is organized" and `site/orgmap.js` (the /how page); `--check` fails on drift. `seed` and `license` are retired pointers; the criticality mirror moved to `metrics/criticality.json`. Open: Q-REPOS-MERGE-WORKERS, Q-REPOS-MERGE-SPEC (reconcile diverged copies), Q-REPOS-ADMIN-APPLY (archive writes need an admin route).

## Spec folded in (Session: session_0156nqDvjKMRKDZZN7ARH5mX)
The spec repository moved here (`specs/`, `SCOPE.md`, `licensing/`, `docs/spec/`) and is a retired pointer. Open: Q-REPOS-MERGE-WORKERS, Q-REPOS-ADMIN-APPLY (archive + admin link).
