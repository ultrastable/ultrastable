# Ultrastable roadmap

Milestones: https://github.com/ultrastable/ultrastable/milestones . Each row is a GitHub issue. Narrative source with owners, triggers and done checks: [docs/roadmap-source.md](docs/roadmap-source.md). Gate FILED items wait for the provisional patent filing ([ip/provisional/FILING-CHECKLIST.md](ip/provisional/FILING-CHECKLIST.md)). 20% of capacity is reserved for pluses.


## Now

- [#14](https://github.com/ultrastable/ultrastable/issues/14) **BIZ-1** Choose owning entity (Business)
- [#15](https://github.com/ultrastable/ultrastable/issues/15) **BIZ-2** Business-in-a-box: managers, customers, competition, pitch kit, funding, promotion, events (`business/plan/`) (Business)
- [#16](https://github.com/ultrastable/ultrastable/issues/16) **FN-1** Map funding and credit programs (Funding)
- [#21](https://github.com/ultrastable/ultrastable/issues/21) **GH-1** Create repos (now seven: add `seed`), install Claude app (GitHub org)
- [#22](https://github.com/ultrastable/ultrastable/issues/22) **GH-2** Push starter content to all six repos (GitHub org)
- [#26](https://github.com/ultrastable/ultrastable/issues/26) **IP-1** Provisional draft: full spec, claims, figures (Patent)
- [#27](https://github.com/ultrastable/ultrastable/issues/27) **IP-2** Prior-art search with differentiators (Patent)
- [#28](https://github.com/ultrastable/ultrastable/issues/28) **IP-3** Fill the evidence log with dated QNFO commits and migrations (Patent)
- [#34](https://github.com/ultrastable/ultrastable/issues/34) **PF-1** Hold the disclosure gate: nothing public until filed (Portfolio)
- [#44](https://github.com/ultrastable/ultrastable/issues/44) **QA-1** Independent review: patent draft vs disclosure vs docs say the same thing (Patent)

## Next

- [#17](https://github.com/ultrastable/ultrastable/issues/17) **FN-2** Google for Startups Cloud Program application (Funding)
- [#18](https://github.com/ultrastable/ultrastable/issues/18) **FN-3** Cloudflare for Startups application (Funding)
- [#19](https://github.com/ultrastable/ultrastable/issues/19) **FN-4** Other credit programs (Anthropic, AWS Activate, Microsoft for Startups, NVIDIA Inception) (Funding)
- [#23](https://github.com/ultrastable/ultrastable/issues/23) **GH-3** Labels, issue templates, a GitHub Project board; load this file as issues (GitHub org)
- [#24](https://github.com/ultrastable/ultrastable/issues/24) **GH-4** Restrict `ip` repo to owner; protect `main` on all repos (GitHub org)
- [#29](https://github.com/ultrastable/ultrastable/issues/29) **IP-4** Counsel review (Patent)
- [#30](https://github.com/ultrastable/ultrastable/issues/30) **IP-5** File provisional (Patent)
- [#31](https://github.com/ultrastable/ultrastable/issues/31) **IP-6** Put the 12-month conversion deadline (non-provisional / PCT) on the calendar with 90/60/30-day reminders (Patent)
- [#35](https://github.com/ultrastable/ultrastable/issues/35) **PL-1** Inventory the QNFO fleet: workers, crons, D1 tables, views, metrics; map each to [architecture](../platform/docs/architecture.md) (Platform)
- [#36](https://github.com/ultrastable/ultrastable/issues/36) **PL-2** Org-chart config schema: roles, objectives, gates, connectors as data (Platform)
- [#45](https://github.com/ultrastable/ultrastable/issues/45) **WEB-1** Deploy `site` as a Worker on a preview URL behind Cloudflare Access, `noindex` (Web and SEO)
- [#48](https://github.com/ultrastable/ultrastable/issues/48) **WEB-4** robots.txt, sitemap.xml, Open Graph tags, Cloudflare Web Analytics (Web and SEO)
- [#49](https://github.com/ultrastable/ultrastable/issues/49) **WEB-5** Domain email (hello@) via Cloudflare Email Routing to Rowan's inbox (Web and SEO)
- [#50](https://github.com/ultrastable/ultrastable/issues/50) **WEB-6** Inventory every QNFO setup step (Search Console, analytics, DNS, email, status, social) and clone the list here (Web and SEO)

## After filing

- [#20](https://github.com/ultrastable/ultrastable/issues/20) **FN-5** Pitch deck, one story with a Cloudflare variant and a GCP variant (Funding)
- [#25](https://github.com/ultrastable/ultrastable/issues/25) **GH-5** Make `.github` public so the org profile shows; `docs` public if chosen (GitHub org)
- [#33](https://github.com/ultrastable/ultrastable/issues/33) **IP-8** Trademark clearance and filing decision for "Ultrastable" (Patent)
- [#42](https://github.com/ultrastable/ultrastable/issues/42) **PR-3** QNFO case study: autonomy rate, trust ledger, plus share, with real numbers (Product and marketing)
- [#46](https://github.com/ultrastable/ultrastable/issues/46) **WEB-2** Attach the ultrastable domains to the site, remove `noindex`, switch footer to "Patent pending" (Web and SEO)
- [#47](https://github.com/ultrastable/ultrastable/issues/47) **WEB-3** Search Console property, DNS verify, submit sitemap (Web and SEO)

## Later

- [#32](https://github.com/ultrastable/ultrastable/issues/32) **IP-7** Non-provisional and/or PCT filing (Patent)
- [#37](https://github.com/ultrastable/ultrastable/issues/37) **PL-3** Tenant isolation design (one org's data never reaches another's) (Platform)
- [#38](https://github.com/ultrastable/ultrastable/issues/38) **PL-4** Ultrastable runs its own backlog: this roadmap as tenant #1, managers on a tick (Platform)
- [#39](https://github.com/ultrastable/ultrastable/issues/39) **PL-5** GCP embodiment sketch (Cloud Run, Cloud Scheduler, Firestore or Cloud SQL, Vertex AI Agent Engine) for the pitch and the patent's "other runtimes" (Platform)
- [#40](https://github.com/ultrastable/ultrastable/issues/40) **PL-6** One-command install for a new organization (Platform)
- [#41](https://github.com/ultrastable/ultrastable/issues/41) **PR-1** Positioning and first customer profile (Product and marketing)
- [#43](https://github.com/ultrastable/ultrastable/issues/43) **PR-4** Pricing hypotheses (Product and marketing)

## Earlier extraction issues

#1-#12 are the product extraction items (entity, policy pack, core tables, pilots, CI); see [ROADMAP-extraction.md](ROADMAP-extraction.md).
