# Failure: the dedicated Cloudflare account was unreachable from every surface tested (2026-11-12)

What was tested (target `81e3a4efb4eb66e613529b87682911bb`):
- Cloudflare API connector: `GET /accounts` returns only `quniverse` (edb167b7...); a call on the target returns HTTP 403 "Authentication error".
- Cloudflare Developer Platform connector: lists the same quniverse workers (45), no second account.
- Session environment: no CLOUDFLARE_* variables bound.
- Deploy to Workers button: needs a public repo; the repo is private.
- wrangler in Actions: needs CLOUDFLARE_API_TOKEN as a repo secret; none is readable or settable from a session.

Root cause: every credential route is scoped to the old account, and the browser sign-in route (`deploy/first-run/first-run.sh`) needs an interactive session.

Fix in this change: the loop no longer waits on the account. The agent-executor (`foundation/executor.py`) runs on GitHub Actions and the Worker only dispatches it; `scripts/cf_account.py` + `cf-account.yml` probe, bootstrap and transfer the moment any token covering the target is bound; the move is a staged, reversible plan (`deploy/transfer/plan.json`). Closing probe: `deploy/cloudflare-accounts.json` target state `running` (gap SG-10).
