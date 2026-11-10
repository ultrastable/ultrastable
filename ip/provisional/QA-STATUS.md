# Provisional QA status (draft version 6, 2026-11-10)

Not legal advice. A registered practitioner must review before filing. Nothing here is filed.

## What was run
1. Claims review (112(b), 112(f), 101, antecedent basis, claim-support matrix, fallback ladders, overlaps): `review/claims-review-2026-11-10.md`.
2. Description review (consistency, definitions, status honesty, enablement, hygiene, figures): `review/description-review-2026-11-10.md`.
3. Prior-art register (non-patent literature only; no patent database search): `../prior-art.md`.

## Applied
- Claims rewritten: 139 claims in 11 families, each with method, system and medium independents, single dependency only, prophetic-only elements in dependents only, technical hooks added for section 101 (CLAIM-TO-SECTION table, now an appendix of CLAIM-STRATEGY.md; formerly at the end of the specification).
- Description: neutral prior-publication wording, personal and internal names removed, drafting notes removed, terminology defined once, contradictions reconciled (model floor vs ladder, SLA tiers, recognition counts, trust computations), status labels corrected, enablement text added (self-amendment replay and others), figure numerals described.
- Paragraphs renumbered consecutively; internal references remapped.

## Open items (for the attorney or the next pass)
- Length: condensed on 2026-11-10 from 137 to 83 specification pages; with 17 drawing pages the package is 100 sheets, the limit set by the owner and by the size fee. Sections 23 to 59 were condensed; sections 1 to 22, the claims and the abstract are unchanged in substance. What was cut is listed in `CUTS.md`; the 137-page text is kept in `archive/v5-137pages/`. `tools/preflight.py` fails above 100 sheets.
- Signal layers L0 to L8 not renamed to avoid collision with other "layer" uses.
- Review Part C cuts G5, G6, G7, G9 (duplicate prose) not applied; audit question list and a graph schema not added.
- Family 10 (self-description) and family 11 (autonomous business chain) independents rest on built parts only; generator, typed views and unattended end-to-end execution are prophetic and claimed only in dependents.
- First cloud provisioning of the seed has not run; stated in the specification.
- Prior publication is an open attorney question (see FILING-CHECKLIST section 1); the specification asserts nothing either way.
- Claim 9-family bootstrap, login (one-time-code) and owner-card claims: attorney to judge 101 and obviousness; one-time-code login alone is likely anticipated, so it is claimed only in dependents.
- Financial back-end functions are not described or claimed.
- Patent database search by counsel still required.
