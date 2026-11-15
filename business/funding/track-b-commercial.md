# Track B: commercial routes

*Voice: funding manager. Credit tables live in `docs/funding/funding-options.md` and win for credit programs; this file adds the routes around them. Status per row: [registry.json](registry.json).*

## Ladder (unchanged from [plan/05-funding.md](../plan/05-funding.md))

Bootstrap, credits, grant, accelerator, pre-seed, seed. Every step is public from the start.

## Programs

| ID | Route | Terms (status) | Fit | Gate |
|---|---|---|---|---|
| B-CF | Cloudflare for Startups | USD 10k / 100k / 350k by tier (secondary) | High: runs on Workers today | Live site, domain email |
| B-GSTART | Google for Startups Cloud | USD 2k Start; up to 350k Scale AI, which needs an institutional round (secondary) | Medium: needs Gemini adapter | Live site; no paid Workspace 31 days before AI application |
| B-AWS, B-MSFT, B-NVIDIA | AWS Activate, Microsoft for Startups, NVIDIA Inception | Small credits, rolling (secondary) | Medium | Live site |
| B-NSFSBIR | NSF SBIR/STTR, Project Pitch then proposal | Phase I about USD 305,000 (secondary; nsf.gov unreachable); authority reported reauthorised to 2031-09-30 | High **if** the company is a US small business majority-owned by US citizens or permanent residents | **Entity location decides this.** Proposals can be marked proprietary; awarded abstracts are public, so file first |
| B-YC | Y Combinator | Standard deal (check); next deadline not published | Medium: solo-founder, idea-person profile is weaker without a business co-founder | Demo day is public |
| B-TECHSTARS | Techstars | USD 220,000 (secondary), dates per programme | Medium | Same |
| B-EIC | EIC Accelerator (EU) | Cut-off 2026-11-04 passed (secondary) | Only with an EU entity | Watch next cut-off |
| Other | Antler, HAX, Seedcamp, Entrepreneur First, Thiel Fellowship (rolling per third-party tracker, unverified) | Equity programs; Antler and Entrepreneur First are built around **co-founder matching** | Relevant to the "someone else runs it" path | Check each site |
| Angels and pre-seed | SAFE from angels and funds | Planning range USD 1.0M to 1.5M (assumption, not market data) | After the case study and first design partners | Terms set with an advisor |

## The "someone else runs the business" path

Rowan is the ideas person. These are the ways a business-capable person or company takes over the commercial side without Rowan becoming a business person. Ranked by how much Rowan keeps.

| Path | How it works | Rowan keeps | Cost / risk | Start |
|---|---|---|---|---|
| **1. Co-founder / CEO search** | Recruit a business co-founder with equity (vesting, IP assigned to the company). Channels: YC Co-Founder Matching, Antler, Entrepreneur First, founder events listed in [plan/07-events.md](../plan/07-events.md) | Founder equity, product direction (CTO / chief inventor role) | Equity split and control; takes months; wrong match is costly | Post a role brief (written in the briefing set) |
| **2. Hired operator / fractional CEO** | Contract a fractional CEO or commercial lead for a fixed term with milestone pay and small equity | Majority equity | Needs cash or a grant to pay them | After first money |
| **3. Licence the IP** | Exclusive or field-limited Commercial License of the code and know-how to an operating company for royalty and equity | Ownership, royalty | Needs a working commercial licence template and a counterparty | After first pilots |
| **4. Open core with a commercial partner** | Core is open; a company (partner or spin-out) sells hosting and enterprise features under a trademark licence | Foundation-style influence, brand | Partner risk; needs clear trademark and contribution terms | At first public release |
| **5. Sale / acquihire** | Sell the company or IP to a platform vendor (agent platforms, cloud providers, developer-tool companies listed in [competitor-map](../briefing/competitor-map.md)) | Cash, maybe a role | Premature before traction; value tied to a working demo and traction | Do not solicit before traction; keep a target list only |

Default in effect: **run path 1 and path 4 together** (see decision memo). Path 2 is the fallback if no co-founder is found by the first review date.

## Owner-only steps (cards, with defaults)

Tracked as issues; see [decision-memo.md](decision-memo.md#owner-cards).

## Eligibility trap list

- Entity location: SBIR needs a US entity; EIC needs an EU entity. The thread's clock suggests Rowan may be in Europe; this is **unconfirmed**. Default in effect: no entity decision is assumed; the jurisdiction follows the first programme that requires an entity.
- Google excludes angel money from the funding test; Cloudflare higher tiers need an affiliated investor.
- Every credit program needs a public site; the site is live.
