# Ultrastable business documents (working drafts, 2026-11-10)

Funding- and investor-facing drafts for Ultrastable. Prepared by the virtual business, marketing and finance managers for Rowan (founder). All drafts: no metric, customer, revenue or quote has been invented; every estimate is labeled ESTIMATE; every field Rowan must confirm is marked `[FOUNDER CONFIRM]`; legal and tax items are `[LAWYER]` / `[ACCOUNTANT]`. Patent text referenced anywhere is a working draft for attorney review, not legal advice.

| File | Purpose |
|---|---|
| [marketing-strategy.md](marketing-strategy.md) | Positioning, ICP, messaging, channels, 90-day calendar, metrics, budget, objections, SAFE NOW vs AFTER FILING |
| [google-for-startups-application.md](google-for-startups-application.md) | Ready-to-paste answers for the Google for Startups Cloud Program, credit plan, pre-submission checklist |
| [investor-one-pager.md](investor-one-pager.md) | One-page investor summary: what exists vs roadmap, ask, risks |
| [pitch-deck-outline.md](pitch-deck-outline.md) | 12 slides with headline, bullets and repo evidence source |
| [demo-script.md](demo-script.md) | 5-minute demo using the real CLI and dashboard |
| [data-room-index.md](data-room-index.md) | Investor data-room checklist with status and owner |
| [financial-model.md](financial-model.md) | Unit-economics formulas and measured inputs; dollar inputs blank, needs an accountant |

## Disclosure rule (read first)

The provisional patent is NOT yet filed. Until it is, these files are internal / NDA-only. Public material (site, public repos, posts, the Google application text) stays outcome-only. Items tagged **SAFE NOW** may be said publicly; **AFTER FILING** items wait for the filing receipt. Never disclose before filing: trust formulas, ladder rungs, prediction-scoring details, the plus-capacity rule, self-amending rules, schemas, QNFO metrics. QNFO/qnfo-workers has been public since 2026-08-10 (it carries a QNFO licence (QNFO User License Agreement v2.1, no commercial use)), so file well before 2027-08-10, and sooner is better.

## Sources used (all in the repo)

- `Dev/ultrastable/PROJECT-INSTRUCTIONS.md`, `Dev/us-remote/README.md`, `HANDOFF.md`, `docs/product-and-positioning.md`
- `Dev/us-remote/org-repos/business/**` (funding.md, plan/00-07), `org-repos/docs/funding/funding-options.md`
- `Dev/us-remote/research/market-read.md`
- Code actually inspected: `Dev/us-platform/ultrastable/{engine,agents,cli,server,demo,config,store}.py`, `tests/test_engine.py`, `deploy/gcp/deploy.sh`. Observed 2026-11-10: 12 unit tests pass; `python -m ultrastable demo` runs 40 ticks with simulated agents.

## Facts that could not be verified from the repo

Legal entity status; whether a Google Cloud / Workspace account exists on ultrastable.io; the provisional filing date; the current Google program tiers and amounts; the funding-options claims about third-party programs (taken from the repo's notes, not re-checked); any live Cloud Run deployment of the platform (the deploy script exists, nothing shows it was run); the Cloudflare adapter (`deploy/cloudflare/` is empty).
