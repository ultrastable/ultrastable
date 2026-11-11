# License review notes for counsel (working draft)

Not legal advice. Prepared 2026-11-11 with an AI assistant. These are the drafting decisions in `LICENSE` (UHL 0.9) and the questions for an attorney. Mark each answer in this file by PR.

## Source and mapping to the QNFO ULA v2.1

Base text: https://raw.githubusercontent.com/QNFO/qnfo-workers/main/LICENSE (read 2026-11-11).

| QNFO-ULA v2.1 | UHL 0.9 | Change |
|---|---|---|
| 2.1, 12.3 non-commercial; commercial list | 3 | Kept; added Specifications and Implementations (3.2(f), 3.6), mixed use and conduit rule (3.4) |
| 10.7 separate commercial license | 4 | Kept; added default revenue share, audit, "no answer is approval" |
| 6.1 85% liquidated damages with fallback | 10.1, 10.2 | Kept 85% and Swiss fallback; added German BGB and a royalty floor |
| 8 Swiss law, ICC Geneva, New York Convention | 11 | Kept; added interim relief in any court, CISG exclusion, local mandatory law |
| 12.4 ShareAlike for Software, 12.7 contributions, 12.5 patents | 5, 7, 2.5 | Kept; extended to Specifications |
| 4, 5 CC BY-NC-SA, prior-art citation, AI restrictions (2.2) | not carried | CC base not needed; AI-training limit kept in 3.2(h); prior-art citation clause omitted (no patent strategy) |
| Preamble values, humanity clauses | not carried | Not needed for a product license |

## Questions for counsel

1. **Specifications and ideas.** Copyright protects expression, not ideas. Section 3.2(f) and 3.6 bind users by contract when they access the Materials. Is that enforceable against someone who reads the specs and builds their own implementation, in the US, the EU (Netherlands, Germany) and elsewhere? What access terms (click-through, repository terms) strengthen it?
2. **85% liquidated damages.** Penalty rules differ (Swiss CO art. 163(3) reduction, German BGB 343, US unenforceable penalties, English penalty rule). Is 85% sensible, or should the primary remedy be a multiple of the standard royalty?
3. **Governing law and seat.** Switzerland and ICC Geneva are inherited from QNFO. Does this fit an owner domiciled in the Netherlands (or abroad), and an entity yet to be formed? Cost of ICC arbitration for small claims; consider an expedited or online option.
4. **Revenue definition.** Does "Revenue" including cost savings and investment value work and survive scrutiny, and how is it audited?
5. **Public-visibility and prior licensing.** The QNFO repository is public under the QNFO ULA. Which files already published may be relicensed under UHL, and is dual licensing cleaner?
6. **Contributor terms.** Is the DCO plus broad license to Licensor enough, or is a CLA needed to relicense commercially?
7. **Entity and assignment.** Name and form of the entity, IP assignment from the author, and moving the Licensor line (LICENSE 14.4).
8. **No patent.** Confirm that dropping the patent route leaves the patent license and retaliation language in 2.5 harmless, and whether the earlier public use limits any later filing in any jurisdiction (the patent drafts are archived in `ip/`).
9. **Sanctions, export and data protection.** Add jurisdiction-specific riders where required.
10. **Consumer law** (11.5) and **mandatory local law** (11.4): any jurisdiction where the license cannot be accepted by conduct.

## Owner-only (identity-bound) steps
Signing with counsel, forming the entity, assigning IP, changing repositories to public. Default in effect: repositories private. Closing probe: counsel notes merged into this file and `python3 scripts/check_license.py` reports `state: private-until-reviewed` changed to `reviewed` in `repo-split.json`.
