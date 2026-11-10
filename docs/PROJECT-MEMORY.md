# Project memory (canonical)

This file is the single source of truth for project memory. Chat memory, tool memory and platform memory stores are read-only pointers to this file and are never edited as a record. Every session starts by reading this file and ends by updating it. Nothing is done until it is deployed end to end; every open item is an issue or an owner card with a default in effect and a closing probe.

Last updated: 2026-11-10
Maintained by: every agent, on every session end. Staleness is checked by `scripts/check_memory.py` (CI `memory-fresh`).

## 1. Standing rules (from Rowan)

1. **If it is not in code, it does not exist.** GitHub org `ultrastable` is canonical for code, files, plans, issues, tasks, agents and instructions. Local files, Library copies, thread output and chat or platform memory are ephemeral. Repos are private.
2. **No open loops.** Autonomy means no open loops, plus iteration. Work ends in completion, not handoff: deployed end to end, verified, recorded. An item leaves the active set only as done, superseded, cancelled, or blocked with owner, blocker and closing probe.
3. **Autonomy first.** Agents act, verify and report as done. They do not ask questions the record can answer. Test every surface before reporting a blocker and say what each returned. Pauses only at steps both irreversible and identity-bound, after engineering reversibility.
4. **Confidentiality until the provisional patent is filed.** Site and details stay off public domains, repos and posts. Only talking points tagged SAFE NOW may be used publicly. Patent drafts are working drafts for attorney review, not legal advice. Business figures are estimates until checked.
5. **Platform-agnostic.** Portable core with Cloudflare and Google Cloud adapters; the working system runs on Cloudflare today.
6. **Reporting.** Project-chat posts are a few plain lines, outcome first, threads linked by title.
7. **Facts are checked at the source** before being stated (licences, disclosures, numbers).
8. **Memory lives in the repo** (this file). See `agents/AGENTS.md` section 1.

## 2. Facts from Rowan

- The QNFO public repository has a licence: the QNFO User License Agreement v2.1, which prohibits commercial use.
- The key combination of the invention has NOT been publicly disclosed. The QNFO repository public since August 2026 is a separate effort.
- Never state in any file that the invention is already disclosed or that QNFO has no licence. What was public and when is only an open question for the patent attorney (`ip/provisional/FILING-CHECKLIST.md`).
- Rowan is the ideas person, not the business person. Virtual managers own business, marketing, funding, legal/IP and ops.
- Working style: judged on results, wants no questions, wants failures logged so the seed improves, wants everything in code and deployed end to end, no open loops.
- Platform stance (2026-11-10): platform-agnostic, cloud-based for now; Cloudflare first, Google adapter second, pitch both.
- Domain `ultrastable.org` is registered (possible Apache-style open-source home).
- Positioning: autonomous business system; financials are NOT claimed; QNFO only as a test case.

## 3. Current status (2026-11-10)

- Main repo `ultrastable/ultrastable` (private) holds the unified layout, patent package (`ip/provisional/`, draft, unfiled, currently v5), business plan, the separate Ultrastable brand (orange/green/cream, not QNFO-like, no research framing), `agents/SELF-AWARENESS.md`, and bootstrap records (`docs/bootstrapping/`, `docs/BOOTSTRAP-GAPS.md`).
- Separate org repos (`site`, `docs`, `platform`, `ip`, `business`, `seed`) exist but are archived duplicates; the monorepo is the system of record (see `docs/BOOTSTRAP-GAPS.md`).
- Dashboard is live at `/owner` on ultrastable.io, .app and .net (Cloudflare worker `ultrastable-dashboard`, source in `dashboard/`). Public pages are a generic holding page.
- Brand/settings build-out (2026-11-10): settings are code in `github/org-settings.json` (workflow `org-settings`, BG-22), community files in `.github/`, site serves PNG social card (BG-24); UI-only brand items are owner card BG-23; audit in `docs/ops/GITHUB-SETTINGS-AUDIT.md`.
- Public GitHub landing (profile and logo) is staged in `brand/public-profile/` but not live; it needs `ORG_ADMIN_TOKEN` (`docs/ops/ORG-TOKEN.md`), after which the `org-init` workflow runs.
- Funding: unfunded; dual track (open source vs commercial) in `docs/funding/` and `business/plan/05-funding.md`. Big credit tiers need an institutional round and a live public site; order is file provisional, publish outcome-only site, apply to small tiers, NSF SBIR, raise. No paid Google Workspace on the ultrastable domain within 31 days before the Google AI program application.
- European priority route (2026-11-10): since the USPTO rule effective 2026-07-20 (91 FR 13510) requires a registered practitioner for foreign-domiciled applicants regardless of citizenship, Rowan will not file a US provisional. Chosen route: Dutch national application at Octrooicentrum Nederland (English description, one Dutch claim, no search requested), then PCT or EPO within 12 months; runner-up direct EPO filing. Package in `ip/europe/` (memo, walkthrough, fee table, form values, owner card). Not legal advice; open attorney questions in `ip/europe/DECISION-MEMO.md` section 7 (foreign filing license depends on where the invention was made; prior disclosure remains an open question, not asserted). The Dutch filing set is built and checked in `ip/europe/filing-nl/` (91 numbered A4 pages incl. 3 Dutch claims, abstract, 33 text-free drawing sheets; rebuild `ip/europe/tools/build_nl.py`, verified by `ip/provisional/tools/preflight.py` section 9). Dutch claims are an unreviewed AI translation; NL fee amount and portal login method for a foreign resident are still unverified.
- Provisional: filing-ready package in `ip/provisional/` (spec PDF 137 pages, drawings FIGS. 1-33, `filing/` cover-sheet data, fee notes, Patent Center walkthrough, `tools/preflight.py` run in CI). Not filed; Rowan's act.
- Cycling: `retriage` workflow (every 3 h) auto-merges green PRs, flags conflicts/idle drafts and files gaps for issues without a doer or probe; `issues` workflow triages hourly.
- Social posting (2026-11-10): `social/` + `scripts/social_*.py` + `social-post` workflow; Bluesky and Mastodon via direct APIs (Buffer skipped, see `social/README.md`); verbatim-excerpt guard over SAFE NOW sources, kill switch in `social/gate.json`; dry-run until owner cards SOC-1/SOC-2 (`docs/ops/SOCIAL-ACCOUNTS.md`) give tokens. Gap BG-25.
- Seed: Python and Worker tests pass; WorkersAIAgent has a first real-model proof (PR #88).

## 4. Owner-only items (identity-bound; each has a default in effect)

| Item | Default in effect | Closing probe |
|---|---|---|
| File the priority application in Europe (identity-bound: sign and pay): `ip/europe/OWNER-CARD.md`; supersedes the US Patent Center walkthrough unless a practitioner is engaged. Default: no filing. Probe: receipt in `ip/evidence-log.md`) |
| (superseded route) File the provisional patent (package ready: `ip/provisional/FILE-THIS-TODAY.md`; `tools/preflight.py` passes; attorney review is optional before filing) | Drafts stay private | Filing receipt recorded in `ip/evidence-log.md` |
| Legal entity and IP assignment (BIZ-1) | `LICENSE` placeholder, proprietary | Entity name in `LICENSE` |
| Mint `ORG_ADMIN_TOKEN` | Holding page only | `org-manage` probe passes; `curl -s https://github.com/ultrastable` shows profile |
| Create/unarchive repos if the fleet cannot | Monorepo is canonical | `gh api repos/ultrastable/<name> --jq .archived` |
| Org avatar upload | Default identicon | Avatar URL is not the identicon |
| Create Bluesky and Mastodon accounts and add their tokens as repo secrets (SOC-1, SOC-2) | Social posting stays dry-run | Secrets listed; first run logs `posted` |
| Submit funding applications | Applications prepared, not sent | Submission confirmation filed in `business/` |

## 5. Workstream map

| Workstream | Where |
|---|---|
| Roadmap and tasks | `ROADMAP.md`, `PROJECTS.md`, GitHub milestones and issues (`docs/ISSUES-BY-AREA.md`) |
| Intellectual property | `ip/`, `ip/provisional/`, `docs/ip/IP-REGISTER.md` |
| Business, customers, competition, funding | `business/`, `docs/funding/`, `research/` |
| Brand and public profile | `brand/` |
| Site and dashboard | `site/`, `dashboard/`, `deploy/` |
| Platform core | `platform/`, `core-manifest/`, `qnfo-platform-thread/` |
| Seed (idea to organization) | `seed/` |
| Agent rules | `agents/AGENTS.md`, `agents/PROJECT-INSTRUCTIONS.md`, `seed/agents/AGENTS.md` |
| Bootstrap log and gaps | `docs/bootstrapping/bootstrap-log.md`, `docs/BOOTSTRAP-GAPS.md` |
| Live systems inventory and hand-off | `docs/ARTIFACTS.md`, `HANDOFF.md`, `docs/handoff/` |

## 6. Update protocol

Update this file in the same PR as any change to status, rules, facts, owner items or workstreams, and at the end of every session. Bump "Last updated". `scripts/check_memory.py` fails the `memory-fresh` workflow when merged work has outrun this file.
