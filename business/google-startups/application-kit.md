# Google for Startups application kit (internal full version)

The submit-ready answers are in [../../external/google-startups-answers.md](../../external/google-startups-answers.md); copy those, not this file, into the form. Source facts: [../../artifacts/funding-options.md](../../artifacts/funding-options.md). Program terms change: re-check before applying. Only the owner can submit.

## Which program, when

| Program | Credits | Gate | Plan |
|---|---|---|---|
| Cloud Program: Start | $2,000 | Founded in last 2 years, working MVP, business model, plans to raise; billing ID, company-domain email, live site | Apply the week the entity, domain email and site exist |
| Cloud Program: Scale AI | up to $350,000 over 2 years | Institutional pre-seed/seed (SAFEs count; angels do not), Gemini central to the product, under $5,000 prior credits | Reapply after the first institutional round; this kit is the application |
| Google for Startups Accelerator | credits and mentoring | regional calls, seed to Series A | Watch for an AI cohort |

## Credits ask and use (planning numbers, estimates)
Ask: Start tier $2,000 now; Scale AI $250,000 in year 1 and $100,000 in year 2 after a round.

| Use of credits (Scale AI year 1) | Share | Milestone it funds |
|---|---|---|
| Vertex AI / Gemini for staff and reviewer roles | 55% | model ladder with doer and reviewer from different families (G3) |
| Cloud Run, Scheduler, Cloud SQL for pilot tenants | 25% | multi-instance store, 3 design-partner deployments (G1, G2) |
| Storage, logging, monitoring, Secret Manager | 10% | evidence retention, audit export |
| Reserve and experiments | 10% | bootstrap from an idea on GCP (G5) |

## Milestones (what Google can check)
G0 adapter skeleton and tests (done). G1 7-day live run on GCP, 1,000 ticks, no silent drop. G2 Postgres store and contention test. G3 Vertex model ladder. G4 dashboard with IAP and phone approvals. G5 idea-to-running-org on GCP. Detail: [../../platform/docs/architecture.md](../../platform/docs/architecture.md).

## Likely questions, with internal-grade answers
- **Why will you use Gemini?** Role-based model ladder maps rungs to Gemini tiers; Vertex lets the reviewer be a different family. Honest: not built (PLANNED, G3).
- **Traction?** One installation (the founder's fleet, self-scored, unaudited). No revenue. Pilots next.
- **Defensibility?** The compounding record of scored outcomes, and the open Ultrastable License that governs use.
- **Risks?** IP ownership (entity and assignment, issue #1), single customer, model cost. Answer on IP: the founder is assigning the technology to the company, and the related QNFO repository is under a license that prohibits commercial use without a separate grant.
- **Biggest dependency on Google?** None technical (portable core); credits cut cost during validation.

## Pre-submit checklist (owner)
Entity and IP assignment (#1) done. Domain email, billing account on company domain, no Workspace purchase within 31 days (Scale AI). Live site claims checked against the repository. Copy answers from `external/` only.
