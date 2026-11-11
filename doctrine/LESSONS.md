# Lessons (each one is also a rule in agents/AGENTS.md and a lint)

## 2026-11-11 No single route
Never design a loop, deploy or start path with one host or one credential. Every path has at least two routes, one of which needs no credential a non-coder would have to mint, and a failed host is detected by silence and replaced automatically. Needing a person to create a token or re-authorize a connector is a failure to be recorded (`docs/failures/`), not a blocker to be reported. Lint: `scripts/check_routes.py` in `checks`. Failure record: `docs/failures/2026-11-11-single-route.md`.
