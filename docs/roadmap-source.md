# Ultrastable roadmap: project #1 is Ultrastable itself

Drafted 2026-11-10. This is the single backlog for launching Ultrastable, run on Ultrastable's own rules (the ones proven in QNFO): every item has an **owner role**, a **trigger** (what makes it ready), a **done check**, and finished items propose a **plus**. When the `platform` repo can load a backlog, this file is its first tenant.

## Where everything lives (the record is git, not chat)

Standing rule from Rowan, 2026-11-10: **if it's not in code, it doesn't exist.** Chat threads can be deleted at any time. Every output is a file in one of these repos, linked from this table, and every status change is a commit to this file.

| What | Repo path | Until the GitHub repos exist |
|---|---|---|
| This roadmap | `docs/roadmap.md` | `/mnt/project-files/ultrastable-repos/docs/roadmap.md` |
| Issue export (one file per item) and GitHub Projects definition | `docs/issues/`, `docs/projects.md` | same folder; `ultrastable-git/create-issues.sh` creates them |
| Concept docs | `docs/concepts/` | same folder, `docs/concepts/` |
| Funding options | `business/funding.md` | `/mnt/project-files/ultrastable-repos/business/funding.md` |
| Business plan and pitch kit (managers, customers, competition, pitch, funding, promotion, events) | `business/plan/` | `/mnt/project-files/ultrastable-repos/business/plan/` |
| Invention disclosure, prior art, evidence log | `ip/` | `/mnt/project-files/ultrastable-repos/ip/` |
| Provisional spec, figures, filing checklist | `ip/provisional/` | `/mnt/project-files/ultrastable-patent/` |
| Landing page and Worker config | `site/` | `/mnt/project-files/ultrastable-repos/site/` |
| Platform architecture | `platform/docs/architecture.md` | `/mnt/project-files/ultrastable-repos/platform/` |
| Org defaults (PR and issue templates) | `.github/` | `/mnt/project-files/ultrastable-repos/.github/` |
| Git history for all six repos (site, docs, platform, ip, business, .github), ready to push | n/a | `/mnt/project-files/ultrastable-git/*.bundle` and `push-all.sh` |

## How to read this

- **Owner** is a virtual role from [virtual staff](concepts/virtual-staff.md). The fleet carries everything except items marked **ROWAN**.
- **ROWAN** items are identity-bound: accounts only Rowan holds, signing or filing, money, the legal entity. Each one says what the fleet prepares so Rowan's part is as short as possible.
- **Gate: FILED** means the item waits until the provisional patent is filed, because it would publicly disclose the invention.
- Priority: **Now** (this week), **Next** (after its trigger), **Later**.
- Capacity rule: 20% of each cycle goes to accepted pluses, not fixes ([plussing](concepts/plussing.md)).

## The short list: what Rowan does, in order

The whole backlog is long; Rowan's part is nine items, and only the first three matter this week.

| # | Item | Time | What the fleet prepares |
|---|---|---|---|
| 1 | **GH-1** Create 6 empty private repos (site, docs, platform, ip, business, .github) under `ultrastable` and install the Claude GitHub App on them | ~10 min | Exact repo names and links (in the GitHub thread) |
| 2 | **BIZ-1** Confirm which legal entity owns Ultrastable (reuse the QNFO entity, or form a new one) | decision | Comparison note; most startup programs require an entity, a website and a domain email |
| 3 | **CONN-1** Reconnect the QNFO MCP Portal connector on claude.ai | ~2 min | Lets the fleet inventory everything QNFO already has set up (PL-1, WEB-6, IP-3) |
| 4 | **IP-4** Pick a patent attorney or agent for a review pass | decision + money | Filing-ready draft, figures, a one-page review brief |
| 5 | **IP-5** File the provisional at USPTO Patent Center and pay the fee | ~1 h | Assembled PDF spec, figures, cover sheet data, entity-status note |
| 6 | **FN-2 / FN-3** Submit Google for Startups Cloud and Cloudflare for Startups applications | ~30 min each | Drafted answers for every field |
| 7 | **WEB-3** Add the domain as a Google Search Console property | ~5 min | DNS verification record added on Cloudflare by the fleet |
| 8 | **WEB-5** Click the verification email for the domain mail forward | ~1 min | Email Routing configured |
| 9 | **IP-8** Decide on a trademark filing for "Ultrastable" | decision + money | Clearance search notes |

## Now (this week)

| ID | Item | Owner | Trigger | Done check | Status |
|---|---|---|---|---|---|
| GH-1 | Create repos (now seven: add `seed`), install Claude app | **ROWAN** | none | Repos visible to the fleet | waiting on Rowan |
| GH-2 | Push starter content to all six repos | Project mgr | GH-1 | Each repo has its README on `main` | ready in [ultrastable-repos](../README.md) |
| IP-1 | Provisional draft: full spec, claims, figures | Staff (IP) | none | Draft covers every element of the [disclosure](../ip/invention-disclosure.md), all figures referenced | draft done: `ip/provisional/` (spec, 14 figures, drawings PDF, filing checklist) |
| IP-2 | Prior-art search with differentiators | Staff (IP) | none | Each [prior-art](../ip/prior-art.md) entry has a link and a "how we differ" line | open |
| IP-3 | Fill the evidence log with dated QNFO commits and migrations | Staff (IP) | CONN-1 | Every claimed element has a dated reduction-to-practice entry | open |
| QA-1 | Independent review: patent draft vs disclosure vs docs say the same thing | Reviewer | IP-1 draft | Mismatch list empty | open |
| BIZ-1 | Choose owning entity | **ROWAN** | none | Entity named in project memory | open |
| FN-1 | Map funding and credit programs | Staff (research) | none | Options saved in git, not only as a page | done: `business/funding.md` |
| PF-1 | Hold the disclosure gate: nothing public until filed | Portfolio mgr | standing | Site on preview URL only, repos private, no public pitch | live rule |
| BIZ-2 | Business-in-a-box: managers, customers, competition, pitch kit, funding, promotion, events (`business/plan/`) | Business mgr | none | All eight files marked reviewed by Rowan in `business/plan/README.md` | drafted 2026-11-10, waiting on Rowan's review |

## Bootstrapping (added 2026-11-10)

| ID | Item | Owner | Trigger | Done check | Status |
|---|---|---|---|---|---|
| BS-1 | Seed repo: IDEA.md, bootstrapper, agent instructions, autonomy policy, Worker tick, tests | Staff (platform) | none | `python3 -m unittest discover tests` and `npm test` pass | done: `seed/` (12 Python tests, 9 Worker tests) |
| BS-2 | AIOS lessons written down | Staff (research) | none | `docs/bootstrapping/aios-lessons.md` | done |
| BS-3 | First real `--apply` on a Cloudflare account; confirm six ticks in an hour (KIT-3) | Ops | GH-2, Cloudflare token | `/health` ok and P-KIT-3 scored hit | open, needs CLOUDFLARE_API_TOKEN (gate card) |
| BS-4 | Executor: call a model with role file + item, record outcomes (PL-7) | Staff (platform) | BS-3 | one item completed end to end by a dispatched role | open |
| BS-5 | Dogfood: boot Ultrastable itself from an IDEA.md and compare the generated backlog to this file | Portfolio mgr | BS-3 | diff reviewed, gaps filed | open |
| BS-6 | Seed as GitHub template repo; one-command install (PL-6) | Staff (platform) | IP-5 (public) | new org boots from a click | later |

## Next (after the trigger)

| ID | Item | Owner | Trigger | Done check |
|---|---|---|---|---|
| GH-3 | Labels, issue templates, a GitHub Project board; load this file as issues | Project mgr | GH-2 | Every row here is an issue with owner, trigger and done check |
| GH-4 | Restrict `ip` repo to owner; protect `main` on all repos | **ROWAN** (org admin) | GH-2 | Settings screenshot or API check |
| WEB-1 | Deploy `site` as a Worker on a preview URL behind Cloudflare Access, `noindex` | Ops | GH-2 | Preview returns 200 for Rowan, 403 for anyone else |
| WEB-4 | robots.txt, sitemap.xml, Open Graph tags, Cloudflare Web Analytics | Staff (web) | WEB-1 | Lighthouse SEO score ≥ 95 on preview |
| WEB-5 | Domain email (hello@) via Cloudflare Email Routing to Rowan's inbox | Ops + **ROWAN** click | none | Test mail arrives |
| WEB-6 | Inventory every QNFO setup step (Search Console, analytics, DNS, email, status, social) and clone the list here | Ops | CONN-1 | Checklist with one row per QNFO service and its Ultrastable twin |
| IP-4 | Counsel review | **ROWAN** | IP-1 + QA-1 | Review notes resolved |
| IP-5 | File provisional | **ROWAN** | IP-4 | Filing receipt with application number in `ip/` |
| IP-6 | Put the 12-month conversion deadline (non-provisional / PCT) on the calendar with 90/60/30-day reminders | Ops | IP-5 | Calendar events exist |
| FN-2 | Google for Startups Cloud Program application | Staff drafts, **ROWAN** submits | BIZ-1, WEB-5 | Submission confirmation |
| FN-3 | Cloudflare for Startups application | Staff drafts, **ROWAN** submits | BIZ-1, WEB-5 | Submission confirmation |
| FN-4 | Other credit programs (Anthropic, AWS Activate, Microsoft for Startups, NVIDIA Inception) | Staff (research) | FN-1 | Ranked list with eligibility |
| PL-1 | Inventory the QNFO fleet: workers, crons, D1 tables, views, metrics; map each to [architecture](../platform/docs/architecture.md) | Staff (platform) | CONN-1 | Mapping table, nothing unaccounted |
| PL-2 | Org-chart config schema: roles, objectives, gates, connectors as data | Product mgr + Staff | PL-1 | Schema loads this roadmap as a test fixture |

## After filing (Gate: FILED)

| ID | Item | Owner | Trigger | Done check |
|---|---|---|---|---|
| WEB-2 | Attach the ultrastable domains to the site, remove `noindex`, switch footer to "Patent pending" | Ops | IP-5 | Domains serve the site over HTTPS |
| WEB-3 | Search Console property, DNS verify, submit sitemap | **ROWAN** adds property, Ops does DNS | WEB-2 | Sitemap status "Success" |
| GH-5 | Make `.github` public so the org profile shows; `docs` public if chosen | Portfolio mgr proposes, **ROWAN** confirms | IP-5 | Org page shows the profile |
| FN-5 | Pitch deck, one story with a Cloudflare variant and a GCP variant | Product mgr | IP-5 | Deck reviewed by Rowan |
| PR-3 | QNFO case study: autonomy rate, trust ledger, plus share, with real numbers | Product mgr | IP-5, PL-1 | Page on the site |
| IP-8 | Trademark clearance and filing decision for "Ultrastable" | Staff researches, **ROWAN** files | IP-5 | Decision recorded |

## Later

| ID | Item | Owner |
|---|---|---|
| PL-3 | Tenant isolation design (one org's data never reaches another's) | Staff (platform) |
| PL-4 | Ultrastable runs its own backlog: this roadmap as tenant #1, managers on a tick | Portfolio mgr |
| PL-5 | GCP embodiment sketch (Cloud Run, Cloud Scheduler, Firestore or Cloud SQL, Vertex AI Agent Engine) for the pitch and the patent's "other runtimes" | Staff (platform) |
| PL-6 | One-command install for a new organization | Staff (platform) |
| PR-1 | Positioning and first customer profile | Product mgr |
| PR-4 | Pricing hypotheses | Product mgr |
| IP-7 | Non-provisional and/or PCT filing | **ROWAN** with counsel, trigger IP-6 reminders |

## Pluses (accepted improvements, not fixes)

These take the reserved 20%. Each came from looking at a finished or in-flight item and asking "what would make this better?"

| Plus | From | Why it's worth it |
|---|---|---|
| **Zero-manual bootstrap**: a new project should start by voice with no hand-created repos; research a GitHub App or org-owner token the fleet holds, so repo creation, push and deploy are automatic | GH-1 | Rowan: if a human has to click, the system hasn't yet learned the lesson |
| **New-project kit**: turn this roadmap's shape (roles, gates, Rowan-only list, pluses) into a template any new project starts from | PL-4 | This is Rowan's actual goal: spin up any project, including our own, the same way |
| Add W. Ross Ashby's "ultrastability" (Design for a Brain, 1952) to prior art and the story: the name has a cybernetics lineage that fits closed feedback loops | IP-2 | Strengthens the narrative and pre-empts an examiner or trademark objection |
| Patent figures double as site and deck diagrams after filing | IP-1, FN-5 | Nine figures already exist; no new design work |
| A weekly portfolio review that reads this file and reports Now/Next movement in four lines | PF-1 | The manager tick, applied to ourselves from day one |
| Funding answers written once as a reusable "company facts" file | FN-2, FN-3 | Every later application takes minutes |

## Portfolio rules for this project

1. **Disclosure gate first.** IP-5 (filing) unlocks the public site, pitches and case study. Everything that can run privately runs now.
2. **Build stays on Cloudflare** because the working system lives there; GCP is pitched as a second embodiment, and the build decision is revisited when credit offers land (FN-2, FN-3).
3. **Rowan's queue stays short.** Anything the fleet can prepare, it prepares, so each ROWAN item is a click, a signature or a decision.
4. **Nothing drops silently.** An item leaves this file only as done, superseded or cancelled, with the reason.
