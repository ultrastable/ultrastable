# Failure: the dedicated Cloudflare account was unreachable from every surface tested (2026-11-12)

What was tested (target `81e3a4efb4eb66e613529b87682911bb`):
- Cloudflare API connector: `GET /accounts` returns only `quniverse` (edb167b7...); a call on the target returns HTTP 403 "Authentication error".
- Cloudflare Developer Platform connector: lists the same quniverse workers (45), no second account.
- Session environment: no CLOUDFLARE_* variables bound.
- Deploy to Workers button: needs a public repo; the repo is private.
- wrangler in Actions: needs CLOUDFLARE_API_TOKEN as a repo secret; none is readable or settable from a session.

Root cause: every credential route is scoped to the old account, and the browser sign-in route (a `wrangler login` script, removed 2026-11-12 under the server-side-only rule) needed an interactive session on a person's computer.

Fix in this change: the loop no longer waits on the account. The agent-executor (`foundation/executor.py`) runs on GitHub Actions and the Worker only dispatches it; `scripts/cf_account.py` + `cf-account.yml` probe, bootstrap and transfer the moment any token covering the target is bound; the move is a staged, reversible plan (`deploy/transfer/plan.json`). Closing probe: `deploy/cloudflare-accounts.json` target state `running` (gap SG-10).

## Red-team of the remaining credential gaps (2026-11-12, second pass)
| Surface | Result |
|---|---|
| Model for the executor: GitHub Copilot coding agent (assign an issue to it) | Not tried live: each assignment spends premium requests and opens an unreviewed PR; wired as provider `copilot` candidate, probe = an issue assigned to `copilot-swe-agent` gets a PR |
| Model: Claude Code in Actions via the installed Claude GitHub App | OIDC only mints a GitHub token; model auth still needs `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` as a repo secret. Not available without one |
| Model: sibling thread sessions | Sibling session on PR #200 has the same connectors and no model API; sessions can drain issues by hand (`python3 -m foundation executor --apply` with a model call from a cloud session), which is the session route |
| New account: device OAuth (`wrangler login`) | Not a server-side route: Cloudflare has no device-code flow, so this login needs a browser callback on a person's computer. Dropped 2026-11-12 (server-side only) |
| New account: Deploy to Workers button | Needs a public template repo; blocked by the confidentiality rule until the license is reviewed (not a credential issue) |
| New account: connectors, env, Actions | See above: all scoped to quniverse |

Result: two secrets only the owner can mint remain. Gate card: `NEEDS-YOU.md`.
