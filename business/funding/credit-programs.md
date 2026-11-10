# Other credit programs (FN-4, issue #19)

Read at the primary pages on 2026-11-10. Only statements the page made are recorded. Entity facts (incorporation, founder-operated) gate most of these; see OC-3 (#105).

| Program | Stated benefit | Stated eligibility | Apply | Status |
|---|---|---|---|---|
| AWS Activate | Credits up to USD 200,000; no tiers listed; extra credits possible for AI startups ("ready to grow", undefined) | None listed | aws.amazon.com/startups/join, destination /credits/apply | Open. Owner submits (OC-4, #106) |
| Microsoft for Startups Founders Hub | Azure credits up to USD 150,000 over time; up to USD 5,000 after business verification | Early-stage software startups, AI and cloud apps accepted; can use another cloud; approval required, criteria not listed | "Get started now" on microsoft.com/startups | Open. Owner submits (#106) |
| NVIDIA Inception | Training, tools, partner offers and cloud credits, VC introductions; no fees, deadlines or cohorts | Incorporated (date given), under 10 years old, working website, clear NVIDIA use case, at least one founder operating; not a consultancy, crypto firm, cloud provider, reseller or public company | "Apply Now" with pitch deck | Open. Needs the entity and the deck |
| Claude Startups (Anthropic) | Offers up to USD 45,000 from partners; up to USD 100K further API credits via a partner VC. Credits work on the first-party API only, not on AWS, Google Cloud or Azure | VC partner route for the larger credit | Subscribe to the Claude Startup newsletter for the next cohort | Applications closed on 2026-11-10 |

## Decisions
- The build stays on Cloudflare; AWS and Azure credits are optional second embodiments, so they rank after Cloudflare (#18) and Google (#17).
- Claude Startups credits cannot fund Vertex or Bedrock runs; use them only for the Claude adapter.
- Every submission is identity-bound (entity, signature, deck). It waits on OC-3 and OC-4; default in effect: not submitted.

Closing probe: `business/funding/registry.json` entries B-AWS, B-MSFT, B-NVIDIA carry `last_verified` 2026-11-10 and status verified; the weekly funding job re-checks them.
