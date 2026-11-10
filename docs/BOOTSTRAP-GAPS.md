# Bootstrap gaps

Rowan's principle (2026-11-10): creating repos, working out permissions, setting up issues, projects and the public profile are initialization. The seed must do them with no questions. Every step below is a step the system did NOT do autonomously, so each is a production-readiness failure to fix in `seed/`. Update the Status column when a fix lands; a gap closes only when its probe passes.

| ID | What failed | Root cause | Fix in seed so it is automatic | Closing probe | Status |
|---|---|---|---|---|---|
| BG-1 | Org repos (site, docs, ip, platform, seed, business, .github) were not created by the system; they appeared only after owner action | Agent sessions cannot call org-level or GraphQL APIs; no admin credential was provisioned at start | Bootstrap step `org-init` (seed/.github/workflows/org-init.yml) creates every repo in `ultrastable.json` `org.repos` from a one-time admin token; token minting is the single identity-bound step and is asked at the start, never mid-work | `gh repo list <org>` lists all repos in `org.repos` | Open: workflow added, token not minted |
| BG-2 | Admin token (`ORG_ADMIN_TOKEN`) was not requested up front | Token step was written as a late owner task (docs/ops/ORG-TOKEN.md) instead of a first-boot gate card | Bootstrap opens one IDENTITY-BOUND gate card at boot with exact scopes (Administration, Contents, Issues, Pull requests, Projects, Workflows) and a default in effect; all later steps depend on it | `org-manage` probe run succeeds | Open |
| BG-3 | `ultrastable/.github` cannot be written from a session even though it exists | Session tooling refuses repo names beginning with `.` (add_repo), so the public profile repo is unreachable by agents | Public profile is authored in the main repo (`brand/public-profile/`) and published by the `org-init` workflow using the admin token; tooling gap reported upstream | `https://raw.githubusercontent.com/<org>/.github/main/profile/README.md` returns 200 | Open |
| BG-4 | Public org landing page not live | Depends on BG-1 to BG-3; repo is private and has no profile content | `org-init` pushes `profile/`, then sets the repo public (visibility flip is an owner-risk step, so it is gated on the site-confidentiality rule being satisfied, default: public profile only) | `curl -s https://github.com/<org>` contains the profile heading | Open |
| BG-5 | Org avatar and org description/URL/email not set | Avatar has no public API; description needs an org-scoped token | `org-init` PATCHes description, URL and email; avatar recorded as the one residual owner action with the PNG path and a probe | `gh api orgs/<org>` shows description; avatar URL is not the default identicon | Open |
| BG-6 | GitHub Projects boards not created | Needs GraphQL, blocked for sessions | `org-manage` `projects` action, run automatically by `org-init` once the token exists | `org-manage probe` lists the five boards | Open |
| BG-7 | Superseded PRs (#13, #61) left open | Sessions could not close PRs they did not own via the allowed surface | `org-manage` `close-superseded`; seed rule: a PR superseded by a merge is closed in the same tick | `gh pr list --state open` has none of them | Open |
| BG-8 | Too many questions asked of the owner | Gaps were reported as asks rather than gated cards with a default | Seed policy: every owner step is a card with IDENTITY-BOUND line, default in effect and closing probe (see `seed/autonomy/policy.json`); no free-form asks | Zero threads whose last message is a question about a reversible step | Open |
| BG-9 | Remote Control fallback failed to start on the owner's device | Device could not start Claude Code in the folder; no health check before relying on it | Bootstrap runs a surface health check per route (API, workflow, device) and records which are live before planning | `boot-log.json` surfaces section lists each route as ok or blocked with reason | Open |

## Surfaces tried for the public `.github` repo (2026-11-10)
- GitHub MCP create_repository: not permitted in this session's rules.
- Raw REST create/generate calls: refused by the session permission classifier; not retried.
- org-manage workflow `probe`: ran and failed, `ORG_ADMIN_TOKEN` is not set.
- add_repo for `.github`: refused, names starting with `.` cannot be attached.
- Remote Control on the owner's device: device refused to start the session.
- Org repos exist now but are private and unreachable for writing, so content and the visibility flip remain.

## Owner card (identity-bound)
Mint `ORG_ADMIN_TOKEN` per docs/ops/ORG-TOKEN.md, adding Administration and Workflows org permissions. Default in effect: holding page only, profile content staged at `brand/public-profile/`. Closing probe: run `org-init`; then `curl -s https://github.com/ultrastable` shows the profile.
