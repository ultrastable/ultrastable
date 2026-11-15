# Lessons (each one is also a rule in agents/AGENTS.md and a lint)

## 2026-11-11 No single route
Never design a loop, deploy or start path with one host or one credential. Every path has at least two routes, one of which needs no credential a non-coder would have to mint, and a failed host is detected by silence and replaced automatically. Needing a person to create a token or re-authorize a connector is a failure to be recorded (`docs/failures/`), not a blocker to be reported. Lint: `scripts/check_routes.py` in `checks`. Failure record: `docs/failures/2026-11-11-single-route.md`.

## 2026-11-15 Publish by procedure, not by session
Every repo of the org is public under USL-1.0, and publishing is run by `python3 -m foundation publication` (policy `doctrine/publication.json`, ledger `ops/publication/ledger.jsonl`). A cloud session cannot change visibility and must not route around that; the flip belongs to a server-side route holding `ORG_ADMIN_TOKEN`. A shallow clone proves nothing about history, so shallow means unmeasured; the flip refuses until the full-history audit is clean and every private-data tripwire path has a recorded disposition. The licence text is never edited. Lint: `publication --check` (in the doctrine step of `checks`), tests `tests/foundation/test_publication.py`.
