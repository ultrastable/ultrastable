# Decision memo: which route

*2026-11-10. From the funding manager to Rowan. Tag: NDA ONLY. Not legal advice; everything marked [LAWYER] goes to the attorney.*

## Recommendation

**Open-core hybrid, filed first.**

- **Open core** under `ultrastable.org`: the portable runtime, adapters, role kit and docs, under an OSI licence, with a governance file. This is what Track A funders, contributors and enterprises can inspect and self-host.
- **Commercial layer** under the company brand: hosted service, managed operations, enterprise connectors, support, and the design-partner program. This is what Track B investors fund.
- **Someone else runs the commercial side**: search for a business co-founder or fractional CEO in parallel; the open core does not depend on that search.
- **Nothing public until the US provisional is filed.**

## Why this and not the pure routes

| Route | Pro | Con | Verdict |
|---|---|---|---|
| Pure open source, grant-funded | Matches "applies to anybody"; no business needed | Funders want released, adopted projects (see Track A); little money before 2027; no one owns the product's growth | Too slow alone |
| Pure commercial, closed | Clearest investor story; patent leverage intact | Rowan is not the business person; five funded rivals sell similar sentences (see competitor map); no distribution advantage | Weak without an operator |
| **Open core + hosted layer** | Credibility and distribution from open; revenue and investor story from hosted; each track funds a different layer | Two audiences; licence and patent choices must be made once and carefully | **Chosen** |

## Sequence (each step has an issue)

1. Attorney review of the provisional; file. (Owner card OC-1.)
2. Attorney answers the licence and patent questions below; choose licence. (OC-2.)
3. Publish outcome-only site; apply to small credit tiers (Cloudflare Tier 3, Google Start, AWS, Microsoft, NVIDIA). Already scheduled in the funding order.
4. Release the open core on `ultrastable.org` after licence decision; fiscal host; GitHub Secure Open Source Fund when adoption exists.
5. NSF SBIR Project Pitch if the entity is eligible; Sovereign Tech Fund or NSF POSE proposal around a base component.
6. Co-founder / CEO search starts at filing; fractional operator fallback at first money.
7. Pre-seed round on the hosted layer after filing, case study and design partners.

## Patent and licence flags for the attorney **[LAWYER]**

1. **Publishing code is public disclosure.** Open-sourcing before the provisional is filed forfeits most foreign rights. File first. Unchanged from the standing confidentiality rule.
2. **Licence choice vs patent leverage.** Apache-2.0 includes an express patent licence from contributors and a defensive termination clause; MIT/BSD have no express patent grant; copyleft licences (AGPL) discourage hosted resale by competitors but deter some enterprises; source-available licences (BSL and similar) are not OSI open source and will disqualify the project from Sovereign Tech Fund, GitHub's fund and most foundations. Question: which licence keeps the patent useful against copycats while meeting funder licence tests?
3. **What the open core may contain.** The provisional describes mechanisms. Releasing code that practises them grants users whatever the chosen licence grants. Question: which components, if any, stay in the commercial layer to preserve exclusivity?
4. **Contributor terms.** CLA or DCO, and company ownership of contributions, so the commercial layer can relicense and the patent position is not clouded.
5. **Trademark.** Register "Ultrastable" and the logo; keep trademark with the company even if code is open; trademark policy file for the open core. Name overlap with another "cybernetic organization" product should be searched. 
6. **QNFO separation.** QNFO's public repo is under the QNFO User License Agreement v2.1 (no commercial use). No QNFO code or text may enter the open core or the commercial layer unless the owner of that code grants rights; provenance review of every file. Question for counsel: what scope of QNFO's existing public material bears on the claims. (Internal question only; no external file characterises it.)
7. **Foundation donation later.** Giving code and trademark to a foundation is irreversible in practice; do not do it before a plan for the commercial layer exists.
8. **Entity and IP assignment.** Rowan-to-company assignment before any investor, grant or licence deal.
9. **Export, grant and SBIR rules.** Federal funding brings government-rights clauses in the resulting IP; read before accepting.

## Owner cards

Each is identity-bound, has a default in effect and a closing probe. Tracked as repo issues (label `owner-card`).

| ID | Step | Why gated | Default in effect | Closing probe |
|---|---|---|---|---|
| OC-1 | File the US provisional (attorney reviews first) | Legal filing, owner identity | Everything public waits; package stays in `ip/provisional/` | Filing receipt committed to `ip/evidence-log.md` |
| OC-2 | Attorney session on the nine flags above, choose licence | Legal advice, owner identity | Open core is **not** published; roadmap assumes Apache-2.0 for the plan only | Licence file committed with attorney's note |
| OC-3 | Form legal entity and assign IP (jurisdiction chosen with counsel) | Legal, money | Applications that need an entity (SBIR, EIC, accelerators) stay unsubmitted | Entity documents in data room index |
| OC-4 | Submit applications (credits, Project Pitch) from owner accounts | Owner identity on forms | Drafts prepared in `external/` and `business/google-startups/`; submission waits for OC-1 | Confirmation emails logged |
| OC-5 | Approve outreach for co-founder / operator search | Sends messages as the owner | Role brief and target list are drafted; nothing sent | First conversations logged |

## Open items as issues

Cost per project tick; cloud OSS credit terms; Sloan/Ford/Mellon/NSF POSE/Apache verification; real adoption plan for the open core; trademark search. All in `docs/issues/FUND-*.json` and filed as GitHub issues.
