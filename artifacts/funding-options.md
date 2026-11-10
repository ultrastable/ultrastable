# Ultrastable funding options

As of 2026-11-10. Living copy: [Claude Doc](https://claude.ai/artifact/NawSpUE1JqP1Ti7EB9NDWZ); this file is the source of record.

## Bottom line

Unfunded, Ultrastable can collect about $18,000 in published credits now, growing to roughly $160,000 with Microsoft usage. The big pools (Google $350,000, Cloudflare $100,000 to $350,000, AWS $200,000) need a first institutional round. Every program also needs a live public website, so filing the provisional comes first.

1. File the US provisional patent.
2. Publish the site with outcome-only wording and a business email on the domain; set up Search Console.
3. Apply the same week to Cloudflare Tier 3 ($10,000), Google Start ($2,000), AWS Founders ($1,000), Microsoft for Startups ($5,000 at verification), Anthropic and NVIDIA Inception.
4. Send an NSF SBIR Project Pitch.
5. Raise a pre-seed round or join a funded accelerator, then reapply for Google Scale AI, Cloudflare Tier 2 and AWS Portfolio.

On platform: build a portable core with Cloudflare and Google adapters and pitch both clouds (see the comparison section).

## Patent disclosure rule

File the US provisional before any application, pitch or demo that describes how the system works to people outside a confidentiality duty. The US gives a one-year grace period after your own disclosure, but Europe, China, Japan and most other countries require absolute novelty, so a public description before filing loses those rights for good.

| Activity | Risk before filing | Why |
| --- | --- | --- |
| Credit applications (Google, Cloudflare, AWS, Microsoft) | Low | Forms ask for company basics and a short product line. Describe the outcome, not the mechanism. |
| SBIR/STTR and other federal proposals | Low to medium | Proposals are confidential and can be marked proprietary, but awarded abstracts are published. File before submitting. |
| Private investor meetings | Medium | Most VCs will not sign an NDA. Keep the deck to problem, outcome and traction; hold the architecture back. |
| Accelerator cohorts and demo days | High | Demo days, cohort announcements and mentor sessions are effectively public. |
| Pitch competitions, public decks, blog posts, the public site | High | Public disclosures on the day they go out. |

Safe one-line description for any form before filing: "Ultrastable runs software teams of AI agents that plan, build and verify their own work." It names the result without the claimed method (virtual managers, the plus loop, predict-and-verify, trust gating).

## Google

The Google money is the [Google for Startups Cloud Program](https://cloud.google.com/startup): up to $350,000 in Google Cloud credits over two years for AI-first startups, but only once Ultrastable has institutional funding. Without a raise, the Start tier gives $2,000.

| Program | What you get | Eligibility | How to apply |
| --- | --- | --- | --- |
| [Cloud Program: Start](https://cloud.google.com/startup) | $2,000 in credits, AI Studio access | Founded in the last 2 years, working MVP, clear business model, plans to raise | Online form with an 18-character billing account ID, a business email on the company domain, and a live website. Decision in 5 to 7 days. |
| [Cloud Program: Scale AI](https://cloud.google.com/startup/ai) | Up to $350,000 over 2 years (year 1: 100% up to $250,000; year 2: 20% up to $100,000 more); covers Gemini and Gemma; 12 months of Workspace Business Plus | Pre-seed or seed in the last 5 years, or Series A in the last 12 months, from a known investor (SAFEs count; angels, grants and friends-and-family do not). Founded in the last 5 years, Gemini central to the product, no more than $5,000 of prior Google credits | [Apply for the AI program](https://cloud.google.com/startup/apply?pt=AI#application-form). Funded stealth startups need an investor or accelerator referral. |
| Cloud Program: Scale (non-AI) | Up to $200,000 over 2 years | Same funding test as Scale AI | Same form |
| [Google for Startups Accelerator](https://startupim.com/investor/google-for-startups-accelerator-ai-first) | Equity-free cohort of about 3 months: mentoring, technical residency, credits | Usually seed to Series A, by region and theme; 2026 cohorts ran in India, MENA and Africa | Regional calls for applications. Cohort membership is announced publicly. |

Traps to clear before applying:

- The website must describe the company, founders and product; Google rejects placeholder or heavily AI-generated sites.
- The Google Cloud account and billing ID must be owned by a user on the company domain.
- For the AI program, the domain must not have had a paid Google Workspace plan in the 31 days before applying. Do not buy Workspace for the ultrastable domain first.

"Google grant" most likely means one of two things. Google Ad Grants is $10,000 a month of search ads for nonprofits only, so it does not apply. The Google for Startups Founders Funds give non-dilutive cash, but only to specific founder groups in periodic rounds (from memory, not verified 2026-11-10).

## Cloudflare

Ultrastable qualifies for Cloudflare's $10,000 bootstrapped tier once the site is live; the $100,000 and $350,000 tiers need funding from a Cloudflare-affiliated investor.

| Program | What you get | Eligibility | How to apply |
| --- | --- | --- | --- |
| [Cloudflare for Startups, Tier 3](https://cloudflare.com/startups/) | $10,000 in credits for 1 year | Bootstrapped or under $1M raised | [Apply here](https://cloudflare.com/lp/startups). Review takes up to 48 hours; email startups@cloudflare.com after a week. |
| Tier 2 | $100,000 for 1 year, possible account manager, technical sessions | Under $5M raised from an affiliated partner | Same form |
| Tier 1 | $350,000 for 1 year, account manager, priority support, Solutions Architect office hours | $5M or more from an affiliated partner | Same form |
| [Workers Launchpad](https://www.cloudflare.com/startups/workers-launchpad) | Access to more than $2B committed by partner VCs, cohort with demo day | Startups building on the Developer Platform | No open call listed. Cohort #6 was announced 22 September 2025, so the next window likely opens around Birthday Week. |

All tiers require: founded in the last 10 years, funded up to Series B within 12 months (bootstrapped counts for Tier 3), a live public website, an active LinkedIn, X or GitHub presence, a business email on the company domain, and no earlier Cloudflare credits. Credits do not cover Workers AI for new startups, AI Gateway is temporarily excluded, and R2 is capped at $10,000. Launchpad demo days are public, so join only after filing.

Cloudflare also plans 2026 startup hubs in San Francisco, Austin, London and Lisbon, open to Launchpad and Startup Program members ([announcement](https://blog.cloudflare.com/tag/workers-launchpad/)).

## GCP vs Cloudflare: a portable core, pitched to both

Build a platform-agnostic core with thin cloud adapters, run Cloudflare as the first production target, and pitch both. The core (managers, staff roles, the plus loop, predict-and-verify, the trust ledger) knows nothing about any cloud; each adapter maps it onto one provider. The credits stack and cover different layers: Cloudflare credits exclude Workers AI, and Google credits cover Gemini.

| Layer | Cloudflare pitch | Google pitch |
| --- | --- | --- |
| Where it runs | Virtual managers and staff as Workers, Durable Objects and the Agents SDK: one stateful agent per role, ticking at the edge | Gemini on Vertex AI as the reasoning engine for every role |
| Their strategic interest | A flagship multi-agent system built natively on their agent stack | A product where Gemini is the foundation, which is the Scale AI test |
| What credits pay for | Workers, Durable Objects, D1, KV, R2 (up to $10,000) | Gemini and Gemma calls, BigQuery for the outcome ledger, Cloud Run if needed |
| Story line | "Autonomous teams that run on Cloudflare's agent platform" | "Gemini-powered virtual staff for any organization" |

The adapters need four seams:

| Seam | Cloudflare adapter | Google adapter |
| --- | --- | --- |
| Agent runtime | Durable Objects, Agents SDK | Cloud Run |
| State store | D1, KV, R2 | Firestore, BigQuery, Cloud Storage |
| Schedule | Cron Triggers, DO alarms | Cloud Scheduler |
| Model provider | Workers AI or external (Gemini, Claude) | Gemini on Vertex AI |

This framing helps both pitches. Each cloud hears "we chose you as a launch platform" with a working adapter to show, and investors hear "no lock-in, sells to any organization's cloud", which matches the any-organization claim in the patent figures. It also gives a sales path: an enterprise adapter (AWS or Azure) becomes a contract deliverable, not a rewrite.

Picking only one cloud loses half the credits and the agnostic story; a full move to GCP throws away a working Workers stack while the Scale AI money still needs a funded round. Build the Google adapter as the second target once Scale AI credits land. Use the outcome wording from the patent section in both pitches until the provisional is filed.

## Other cloud and AI credits

Microsoft is the largest credit pool open without a raise: up to $150,000 of Azure credits unlocked by usage milestones. The rest pay little until a funded round.

| Program | Without a raise | With institutional funding | Notes |
| --- | --- | --- | --- |
| [Microsoft for Startups](https://fin.ai/learn/startup-credit-programs) | $200 at signup, $5,000 at business verification, then $25,000, $50,000 and $150,000 at 5, 7 and 10+ workloads | Investor Network code, usually starting at $100,000 | Pre-seed to Series C B2B software; includes Azure OpenAI and GitHub Enterprise; credits last up to 2 years |
| [AWS Activate](https://aws.amazon.com/aws-startups/learn/applying-for-aws-activate-credits-a-step-by-step-guide) | Founders: $1,000, up to $5,000 over time | Portfolio: up to $200,000 with an Activate Provider Org ID; more for AI startups via an account manager | Founded in the last 10 years, live website; decision in 7 to 10 business days |
| [Anthropic Startup Program](https://fin.ai/learn/startup-credit-programs) | Open to apply; amount not published | Credits in practice tied to institutional funding | Founded in the last 4 years; first-party Claude API only |
| [OpenAI for Startups](https://fin.ai/learn/startup-credit-programs) | Community and events, no credits | API credits through partner VCs only | Amount not published |
| [NVIDIA Inception](https://fin.ai/learn/startup-credit-programs) | Free membership, partner credits, hardware rebates | Same | Pitch deck required; keep it outcome-level before filing |

Anthropic and Microsoft are worth applying to now: Claude already does much of the Ultrastable build work, and Azure credits can pay for model inference through Azure OpenAI while the core stays portable.

## Grants and non-dilutive money

The one real grant for a US software startup is SBIR/STTR, and it is open again: Congress reauthorized it through 30 September 2031, signed 13 April 2026 ([summary](https://fundinglandscape.com/answers/sbir-sttr-reauthorization-2026)). This assumes Ultrastable is a US company.

| Program | Amount | Fit for Ultrastable | How to apply |
| --- | --- | --- | --- |
| NSF SBIR/STTR (America's Seed Fund) | Phase I roughly $305,000, Phase II roughly $1.25M (approximate; confirm in the current solicitation) | Good: NSF funds high-risk technical innovation and takes no equity | Submit a 3-page Project Pitch at seedfund.nsf.gov, then a full Phase I proposal if invited. NSF relaunched with $250M in FY26 ([CASRAI](https://casrai.org/news/nsf-sbir-sttr-fy26-relaunch)). |
| DoD, DOE and other agency SBIRs | Phase I typically $150,000 to $300,000 | Possible if a topic asks for autonomous software or AI operations | Topic-driven solicitations on sbir.gov |
| Google Ad Grants | $10,000 a month in ads | None: nonprofits only | Not applicable |

From fiscal 2027 each agency caps how many proposals a company can file per year, so one strong NSF pitch beats several weak ones. Proposals stay confidential, but award abstracts are published, so file the provisional before submitting.

## Investor routes

A first institutional cheque matters more than its size: it unlocks Google Scale AI ($350,000), Cloudflare Tier 2 ($100,000), AWS Portfolio ($200,000) and the OpenAI and Anthropic VC routes together.

| Route | Typical money | Unlocks credits | Disclosure risk before filing |
| --- | --- | --- | --- |
| Accelerator with an investment (Y Combinator, Techstars and similar) | Roughly $125,000 to $500,000 on a SAFE (approximate) | Yes: they are partners in most credit programs | High: demo day is public |
| Equity-free accelerators (Google for Startups, Workers Launchpad) | No cash; credits and intros | Partly | High: cohorts are announced |
| Pre-seed VC on a SAFE | Often $250,000 to $1.5M (approximate) | Yes, when the firm is a known institutional investor | Medium: private meetings, no NDA |
| Angels | $25,000 to $250,000 each | No: Google excludes angel money from Scale | Medium |
| Licensing or selling the IP | Depends on the patent | Not applicable | Low once filed; buyers value a filed patent far more than an idea |

Selling Ultrastable outright works best after the provisional is filed and a working reference deployment exists; QNFO already serves as one.

## Follow-up: Google Search Console

Set up Search Console for the Ultrastable domains the same way as QNFO, but only once the public site goes live after filing; indexing a site that describes the method is a public disclosure.

- [ ] Add each Ultrastable domain as a Domain property in Search Console (owner's Google account)
- [ ] Add the TXT verification record in Cloudflare DNS
- [ ] Submit the sitemap from the site Worker
- [ ] Keep robots blocking indexing until the provisional is filed
- [ ] Create the Google Cloud billing account under a user on the company domain (required for the Startup application)

## Sources

Pages opened 2026-11-10:

- [Google for Startups Cloud Program](https://cloud.google.com/startup)
- [Google for Startups AI program](https://cloud.google.com/startup/ai)
- [Cloudflare for Startups](https://cloudflare.com/startups/)
- [Workers Launchpad](https://www.cloudflare.com/startups/workers-launchpad)
- [Cloudflare blog: Workers Launchpad tag](https://blog.cloudflare.com/tag/workers-launchpad/)
- [AWS Activate application guide](https://aws.amazon.com/aws-startups/learn/applying-for-aws-activate-credits-a-step-by-step-guide)
- [Startup credit programs compared (Fin)](https://fin.ai/learn/startup-credit-programs) — Microsoft, Anthropic, OpenAI, NVIDIA figures
- [SBIR/STTR reauthorization summary](https://fundinglandscape.com/answers/sbir-sttr-reauthorization-2026)
