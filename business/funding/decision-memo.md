# Decision memo: which route

*2026-11-10. From the funding manager to Rowan. The project is open; the Ultrastable License governs use.*

## Recommendation

**Open-core hybrid, public from the start.**

- **Open core** under `ultrastable.org`: the portable runtime, adapters, role kit and docs, public, with a governance file; the Ultrastable License governs use (free for non-commercial use; Commercial License with revenue share for commercial use). A funder that requires an OSI-approved licence is a separate eligibility test, listed per programme in Track A. This is what Track A funders, contributors and enterprises can inspect and self-host.
- **Commercial layer** under the company brand: hosted service, managed operations, enterprise connectors, support, and the design-partner program. This is what Track B investors fund.
- **Someone else runs the commercial side**: search for a business co-founder or fractional CEO in parallel; the open core does not depend on that search.
- **Public now.** The repositories are open and the licence protects the work.

## Why this and not the pure routes

| Route | Pro | Con | Verdict |
|---|---|---|---|
| Pure open source, grant-funded | Matches "applies to anybody"; no business needed | Funders want released, adopted projects (see Track A); little money before 2027; no one owns the product's growth | Too slow alone |
| Pure commercial, closed | Clearest investor story | Rowan is not the business person; five funded rivals sell similar sentences (see competitor map); no distribution advantage | Weak without an operator |
| **Open core + hosted layer** | Credibility and distribution from open; revenue and investor story from hosted; each track funds a different layer | Two audiences; the licence is set once and applied everywhere | **Chosen** |

## Sequence (each step has an issue)

1. Keep the Ultrastable License as the single licence for the open core (OC-2).
2. Publish the site and repositories (done).
3. Apply to small credit tiers (Cloudflare Tier 3, Google Start, AWS, Microsoft, NVIDIA). Already scheduled in the funding order.
4. Release the open core on `ultrastable.org` after licence decision; fiscal host; GitHub Secure Open Source Fund when adoption exists.
5. NSF SBIR Project Pitch if the entity is eligible; Sovereign Tech Fund or NSF POSE proposal around a base component.
6. Co-founder / CEO search starts now; fractional operator fallback at first money.
7. Pre-seed round on the hosted layer after the case study and design partners.

## Licence notes

1. **Licence and funder tests.** The Ultrastable License is source-available: free for non-commercial use, Commercial License with revenue share for commercial use. Some funders (Sovereign Tech Fund, GitHub's fund, most foundations) require an OSI-approved licence; those programmes are marked as eligibility-blocked in Track A until a component is released under one.
2. **What the open core contains.** Everything in the open repositories is governed by the licence; the commercial layer is the hosted service, managed operations and support.
3. **Contributor terms.** CLA or DCO, and company ownership of contributions, so the commercial layer can relicense.
4. **Trademark.** Register "Ultrastable" and the logo; keep the trademark with the company; trademark policy file for the open core. Search the name overlap with another "cybernetic organization" product.
5. **QNFO separation.** QNFO's public repo is under the QNFO User License Agreement v2.1 (no commercial use). No QNFO code or text may enter Ultrastable unless the owner of that code grants rights; provenance review of every file.
6. **Foundation donation later.** Giving code and trademark to a foundation is irreversible in practice; do not do it before a plan for the commercial layer exists.
7. **Entity and IP assignment.** Rowan-to-company assignment before any investor, grant or licence deal that requires an entity.
8. **Export, grant and SBIR rules.** Federal funding brings government-rights clauses in the resulting IP; read the programme terms before accepting.

## Owner cards

Each is identity-bound, has a default in effect and a closing probe. Tracked as repo issues (label `owner-card`).

| ID | Step | Why gated | Default in effect | Closing probe |
|---|---|---|---|---|
| OC-2 | Confirm the licence for the open core | Owner's choice of terms | The Ultrastable License applies; the open core is published | Licence file in every repository |
| OC-3 | Form a legal entity and assign IP, only where a programme requires an entity | Money, owner identity | Applications that need an entity (SBIR, EIC, accelerators) wait on the entity; everything else proceeds | Entity documents in data room index |
| OC-4 | Submit applications (credits, Project Pitch) from owner accounts | Owner identity on forms | Drafts prepared in `external/` and `business/google-startups/`; submission is by the owner | Confirmation emails logged |
| OC-5 | Approve outreach for co-founder / operator search | Sends messages as the owner | Role brief and target list are drafted; nothing sent | First conversations logged |

## Open items as issues

Cost per project tick; cloud OSS credit terms; Sloan/Ford/Mellon/NSF POSE/Apache verification; real adoption plan for the open core; trademark search. All in `docs/issues/FUND-*.json` and filed as GitHub issues.
