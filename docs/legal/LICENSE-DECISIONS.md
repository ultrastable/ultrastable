# License decisions record (USL-1.0)

Decided 2026-11-11 by the Ultrastable fleet at the owner's direction: there is no outside legal review, and the fleet is the final reviewer. This file replaces the earlier "questions for counsel" list. Each question has a decision, the reason, and what would make us revisit it. This is a considered design decision based on published license practice, not a guarantee that any court will agree; the license is written to degrade safely (severability, reformation to the nearest enforceable measure) so that a part failing does not unwind the rest.

Sources read 2026-11-11: QNFO ULA v2.1 (the base); BUSL 1.1 as described by Wikipedia and MariaDB's FAQ; Sentry's Functional Source License page; Directus's v12 license announcement; PolyForm Project's open-core page; published n8n license and pricing summaries; published take-rate comparisons. Pricing rationale is in `COMMERCIAL-TERMS.md`.

## Decisions

1. **Specifications and ideas (copyright does not protect ideas).** Decision: keep `LICENSE` Section 7 as written. It is a contract condition on access ("as a condition of Your use of the Specification"), limited to where law allows, and carves out independent implementations made without the Specification and any right the law gives. Enforceable mainly against people who read and accept it; clean-room reimplementers are outside it by design. Strengthening: published specs carry the license header; `workers` and `spec` READMEs state it at the top; acceptance by use is in Section 18.5. Revisit if a competitor builds from the specs, then enforce through contract claims and the Section 7.3 conformance mark.
2. **Damages.** Decision: keep Section 5 as written (greater of 3x the Commercial Terms amount and a reasonable royalty, with automatic reduction to what a tribunal finds enforceable). A multiple of the price list is easier to defend as a pre-estimate than a percentage of all revenue, and the reduction clause (5.4) handles penalty rules such as Swiss CO art. 163(3) and German BGB 343. The earlier 85% draft was dropped.
3. **Law and seat.** Decision: Swiss law, ICC arbitration in Geneva, English, one arbitrator, New York Convention enforcement, interim relief in any court (Section 17). Neutral, familiar to international parties, inherited from QNFO. Cost for small claims is real; the license's practical enforcement path for small users is takedown and platform pressure (Section 17.3), with arbitration for material cases.
4. **Revenue definition.** Decision: "Covered Revenue" is money and market value of consideration from the product, service or organization run with material use of the Materials, less refunds, taxes and pass-through costs, counted when received, separable product lines allowed with separate books (`COMMERCIAL-TERMS.md` 2). Cost savings are not charged in the revenue share (only in the Internal fee), which keeps the base auditable. Audit by officer statement and records (4).
5. **Previously published QNFO files.** Decision: `LICENSE` 18.5 keeps already-distributed QNFO ULA files under the QNFO ULA; USL-1.0 applies to Ultrastable releases from 2026-11-11. No relicensing of QNFO content.
6. **Contributor terms.** Decision: Section 11 (DCO-style certification plus a broad license to the Licensor, including relicensing and patent grant) is sufficient for a single-owner project and lets the Licensor sell one Commercial License over the whole work. No separate CLA.
7. **Entity and assignment.** Decision: no blocker. The Licensor is the author; Section 19 allows assignment to a company later with a notice at `ultrastable/license`, and Commercial Licenses pass with it. Forming an entity is a business step, not a precondition for the license.
8. **No patent.** Decision: patents are not asserted (Section 10.4). The non-commercial patent license, retaliation and prior-art citation clauses are harmless if no patent exists and protective if a contributor or third party files one. Earlier public use was a reason for dropping the patent; the drafts are archived in `ip/`.
9. **Sanctions, export, data protection.** Decision: Section 4.1(d) allows refusal where law, sanctions or export control bar dealing; Section 17.4 requires users to follow their own laws. The Software handles no personal data by itself; operators are responsible for their deployments (Section 15).
10. **Consumer law and acceptance by conduct.** Decision: personal non-commercial use is free, so consumer-protection law rarely applies; Section 17.4 yields to mandatory local law "to the nearest permitted extent". Acceptance by use (18.5) is backed by the notice header on each file (Section 21) and the README banner; the repositories are not published until that is in place.

## Clarity checks (plain reading, any country)
- Free list is closed and short (2.2); everything that makes or saves money is commercial (3.1).
- Price list is published and can be accepted without negotiation (4.1).
- English text controls; plain-language summary is non-binding.
- Not open source and says so (14).

## Open items that are not legal gates
Publishing the repositories is the owner's visibility change (default: private). Forming an entity and moving the Licensor line (Section 19) is a business step. Nothing here waits on a lawyer.
