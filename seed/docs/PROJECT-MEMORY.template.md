<!-- Template: the bootstrap renders this to docs/PROJECT-MEMORY.md for a new org and fills the facts from IDEA.md. -->
# Project memory (canonical)

This file is the single source of truth for project memory. Chat memory, tool memory and platform memory stores are read-only pointers to this file and are never edited as a record. Every session starts by reading this file and ends by updating it. Nothing is done until it is deployed end to end; every open item is an issue or an owner card with a default in effect and a closing probe.

Last updated: 2026-11-10
Maintained by: every agent, on every session end. Staleness is checked by `scripts/check_memory.py` (CI `memory-fresh`).

## 1. Standing rules (from Rowan)

1. **If it is not in code, it does not exist.** GitHub org `ultrastable` is canonical for code, files, plans, issues, tasks, agents and instructions. Local files, Library copies, thread output and chat or platform memory are ephemeral. Repos are private.
2. **No open loops.** Autonomy means no open loops, plus iteration. Work ends in completion, not handoff: deployed end to end, verified, recorded. An item leaves the active set only as done, superseded, cancelled, or blocked with owner, blocker and closing probe.
3. **Autonomy first.** Agents act, verify and report as done. They do not ask questions the record can answer. Test every surface before reporting a blocker and say what each returned. Pauses only at steps both irreversible and identity-bound, after engineering reversibility.
4. **Nothing public until the owner says so.** Site and details stay off public domains, repos and posts until the owner publishes. Only talking points tagged SAFE NOW may be used publicly. Legal texts (licenses, specs notes) are written and reviewed by the fleet; decisions are recorded in the repo. Business figures are estimates until checked.
5. **Platform-agnostic.** Portable core with Cloudflare and Google Cloud adapters; the working system runs on Cloudflare today.
6. **Reporting.** Project-chat posts are a few plain lines, outcome first, threads linked by title.
7. **Facts are checked at the source** before being stated (licences, disclosures, numbers).
8. **Memory lives in the repo** (this file). See `agents/AGENTS.md` section 1.

## 2. Facts from Rowan

- The QNFO public repository has a licence: the QNFO User License Agreement v2.1, which prohibits commercial use.
- Ultrastable protects its code and specifications with a hybrid license (free non-commercial, Commercial License for commercial use), not a patent (decision 2026-11-11).
- Never state that QNFO has no licence. Never describe the system as patent pending.
- Rowan is the ideas person, not the business person. Virtual managers own business, marketing, funding, legal/IP and ops.
- Working style: judged on results, wants no questions, wants failures logged so the seed improves, wants everything in code and deployed end to end, no open loops.
- Platform stance (2026-11-10): platform-agnostic, cloud-based for now; Cloudflare first, Google adapter second, pitch both.
- Domain `ultrastable.org` is registered (possible Apache-style open-source home).
- Positioning: autonomous business system; financials are NOT claimed; QNFO only as a test case.

## 3. Current status (2026-11-10)

- Main repo `ultrastable/ultrastable` (private) holds the unified layout, patent package (`ip/provisional/`, draft, unfiled, currently v5), business plan, the separate Ultrastable brand (orange/green/cream, not QNFO-like, no research framing), `agents/SELF-AWARENESS.md`, and bootstrap records (`docs/bootstrapping/`, `docs/BOOTSTRAP-GAPS.md`).
- Separate org repos (`site`, `docs`, `platform`, `ip`, `business`, `seed`) exist but are archived duplicates; the monorepo is the system of record (see `docs/BOOTSTRAP-GAPS.md`).
- Dashboard is live at `/owner` on ultrastable.io, .app and .net (Cloudflare worker `ultrastable-dashboard`, source in `dashboard/`). Public pages are a generic holding page.
- Public GitHub landing (profile and logo) is staged in `brand/public-profile/` but not live; it needs `ORG_ADMIN_TOKEN` (`docs/ops/ORG-TOKEN.md`), after which the `org-init` workflow runs.
- Funding: unfunded; dual track (open source vs commercial) in `docs/funding/` and `business/plan/05-funding.md`. Big credit tiers need an institutional round and a live public site; order is file provisional, publish outcome-only site, apply to small tiers, NSF SBIR, raise. No paid Google Workspace on the ultrastable domain within 31 days before the Google AI program application.
- Seed: Python and Worker tests pass; WorkersAIAgent has a first real-model proof (PR #88).

## 4. Owner-only items (identity-bound; each has a default in effect)

| Item | Default in effect | Closing probe |
|---|---|---|
| Publish the repositories (changes visibility) | Everything stays private | Repository visibility is public |
| Legal entity and IP assignment (BIZ-1) | `LICENSE` placeholder, proprietary | Entity name in `LICENSE` |
| Mint `ORG_ADMIN_TOKEN` | Holding page only | `org-manage` probe passes; `curl -s https://github.com/ultrastable` shows profile |
| Create/unarchive repos if the fleet cannot | Monorepo is canonical | `gh api repos/ultrastable/<name> --jq .archived` |
| Org avatar upload | Default identicon | Avatar URL is not the identicon |
| Submit funding applications | Applications prepared, not sent | Submission confirmation filed in `business/` |

## 5. Workstream map

| Workstream | Where |
|---|---|
| Roadmap and tasks | `ROADMAP.md`, `PROJECTS.md`, GitHub milestones and issues (`docs/ISSUES-BY-AREA.md`) |
| Intellectual property | `ip/`, `ip/provisional/`, `docs/ip/IP-REGISTER.md` |
| Business, customers, competition, funding | `business/`, `docs/funding/`, `research/` |
| Brand and public profile | `brand/` |
| Site and dashboard | `site/`, `dashboard/`, `deploy/` |
| Platform core | `platform/`, `core-manifest/` |
| Seed (idea to organization) | `seed/` |
| Agent rules | `agents/AGENTS.md`, `agents/PROJECT-INSTRUCTIONS.md`, `seed/agents/AGENTS.md` |
| Bootstrap log and gaps | `docs/bootstrapping/bootstrap-log.md`, `docs/BOOTSTRAP-GAPS.md` |
| Live systems inventory and hand-off | `docs/ARTIFACTS.md`, `HANDOFF.md`, `docs/handoff/` |

## 6. Update protocol

Update this file in the same PR as any change to status, rules, facts, owner items or workstreams, and at the end of every session. Bump "Last updated". `scripts/check_memory.py` fails the `memory-fresh` workflow when merged work has outrun this file.
