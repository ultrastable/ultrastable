# Investor data-room index (2026-11-10)

Status codes: **HAVE** (exists, path given), **DRAFT** (working draft exists), **NEEDS ACCOUNTANT**, **TODO** (nothing yet). Paths are relative to the root of the workspace that holds the repositories side by side. Owners are roles; Rowan alone signs and pays.

| # | Item | Status | Where / note | Owner |
|---|---|---|---|---|
| 1 | One-pager | DRAFT | `us-business-new/investor-one-pager.md` | Finance manager |
| 2 | Pitch deck outline | DRAFT | `us-business-new/pitch-deck-outline.md` (slides not built) | Marketing manager |
| 3 | Demo script and recording | DRAFT script / TODO video | `us-business-new/demo-script.md` | Marketing + Rowan |
| 4 | Product code and tests | HAVE | `us-platform/` (12 tests pass 2026-11-10) | Product manager |
| 5 | Product docs / positioning | HAVE | `us-remote/docs/product-and-positioning.md`, `ultrastable/PROJECT-INSTRUCTIONS.md` | Business manager |
| 6 | Competitive analysis | HAVE | `us-remote/org-repos/business/plan/03-competition.md`, `research/market-read.md` (to be refreshed within 30 days) | Research staff |
| 7 | Business plan | HAVE | `us-remote/org-repos/business/plan/00-07` | Business manager |
| 8 | Funding plan | HAVE | `business/funding.md`, `docs/funding/funding-options.md` | Finance manager |
| 9 | Use of funds / budget | DRAFT | One-pager + plan/05 percentages; 18-month budget model TODO | Finance manager, **NEEDS ACCOUNTANT** |
| 10 | Financial model and runway | STRUCTURE ONLY | [financial-model.md](financial-model.md): formulas and measured inputs, dollar inputs blank | Finance manager, **NEEDS ACCOUNTANT** |
| 11 | Entity formation documents | TODO | no entity recorded | Rowan `[ACCOUNTANT]` |
| 12 | Cap table | TODO | after entity | Rowan |
| 13 | Founder IP assignment / licence of QNFO-origin code to the company | TODO | main investor risk (HANDOFF.md) | Rowan |
| 16 | Licence record of qnfo-workers (public since 2026-08-10, carries a QNFO licence (QNFO User License Agreement v2.1, no commercial use)) | HAVE (fact) | HANDOFF.md | Licence steward |
| 17 | Trademark search (Ultrastable; note "cybernetic organizations" overlap) | TODO | product doc section 7 partial only | Licence steward |
| 18 | NDA template | TODO | only for counterparties that require one | Licence steward |
| 19 | Domains and site | HAVE | ultrastable.io/.app/.net, worker `ultrastable-site`, `us-remote/site/` (note: registered inside QNFO's Cloudflare account; transfer to the company later) | Operations |
| 20 | GitHub repo | HAVE | https://github.com/ultrastable/ultrastable (12 issues; Projects board missing) | Operations |
| 21 | QNFO case study with real numbers | TODO | source figures in product doc section 3, self-measured | Customer success |
| 22 | Customer pipeline / discovery log | TODO | `customers/discovery-log.md` not created; no calls logged | Sales manager |
| 23 | Pilot terms / design-partner agreement | TODO | draft needed | Sales manager |
| 24 | Credit program applications | DRAFT | `us-business-new/google-for-startups-application.md`; others not drafted | Finance manager |
| 25 | Grant (NSF SBIR) materials | TODO | Project Pitch; full proposal 2027-03-04 or 2027-07-07 per funding notes (verify) | Finance manager |
| 26 | Tax and accounting setup | TODO | **NEEDS ACCOUNTANT** | Rowan |
| 27 | Security / privacy summary | TODO | token-protected writes exist; no formal review | Operations |
| 28 | Risk register | DRAFT | risks section of the one-pager | Business manager |
| 29 | Team and hiring plan | DRAFT | `plan/01-management-roster.md`; founding engineer + part-time commercial lead | Business manager |
| 30 | Cloud deployment evidence (Cloud Run URL) | TODO | `us-platform/deploy/gcp/deploy.sh` exists; no live deployment recorded | Operations |

## Rules
- The folder is open; use an NDA (#18) only where a counterparty requires one.
- Nothing in the room may claim a metric, customer or revenue that is not evidenced by a file here.
- Update this index when an item changes status; the reviewer agent re-checks it monthly.
