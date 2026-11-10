# Prefilled form values (Dutch application; EPO and PCT columns for later)

Not legal advice. **Bold** = only Rowan can supply (identity data). Package facts checked 2026-11-10: specification PDF 83 pages, drawings 17 sheets (FIGS. 1 to 33), 139 claim-style summaries in 11 families. (The earlier "137 pages" figure in `ads-data.json` was stale and is corrected to 83.)

## 1. Values (same across offices unless noted)

| Field | Value |
|---|---|
| Kind of filing | Dutch national patent application (NL); later PCT / EP |
| Title | As in `provisional-specification.md`, "TITLE OF THE INVENTION" (copy from `filing/ads-data.json`) |
| Applicant | Rowan **[family name]**, natural person, resident in the Netherlands (**address**) |
| Inventor | Same person, sole inventor of record; **nationality: US** |
| Representative | None (self-filed) |
| Correspondence e-mail | **[address for receipts]** |
| Priority claim | None (this is the first filing) |
| Search request at filing | **No** (request within 13 months only if wanted) |
| Language of description and abstract | English |
| Language of claims | Dutch (NL only); English for EP and PCT |
| Description | `provisional-specification.pdf` after reformatting (section 4) |
| Drawings | `drawings.pdf` after relabelling (section 4) |
| Docket | ULTRA-PROV-001 (keep; add -NL) |

## 2. Dutch claim (NL only)

NL requires claims in Dutch. File **one** short independent claim in Dutch drawn from the broadest claim-style summary in the specification (summary 1), translated by Rowan; the specification, not the claim, carries the priority. Dutch wording and scope are an attorney question (`DECISION-MEMO.md` section 7, item 4). The 139 summaries stay in the description as support.

## 3. EPO Form 1001 (fallback)

Applicant and inventor as above; no representative (Art. 133(1) EPC); language English; no priority; description + drawings; at most 15 claims or none at filing; pay the filing and search fees within one month; designation fee not paid at filing.

## 4. Changes the existing package needs before any European filing

1. **Language:** English is accepted at OCNL for the description, abstract and drawing text; at the EPO English is an official language. No translation of the specification is needed; only the NL claim.
2. **Page format (NL):** margins 2 cm top/right/bottom, 2.5 cm left; description starts at page 1, claims continue the numbering. The PDF is built by `ip/provisional/tools/build.sh` with `style.css`; produce a separate `europe/` build with these margins and no running headers inside the margins. (Build to follow in a later change.)
3. **Drawings:** OCNL says text labels in drawings are generally not allowed; the EPO also restricts text (Rule 46). FIGS. 1 to 33 contain labels. Replace labels with reference numerals and add a legend in the description ("List of reference signs"). This is the largest piece of work and is tracked as an open item.
4. **Claim-style summaries** are in the description and stay there.
5. **Page counts:** EPO charges page fees above page 35 (estimate in `FEE-TABLE.md`).
6. **No generative AI tools on the text before filing** (OCNL warning).
7. **Confidentiality:** the folder `ip/europe/` repeats no specification or claim text; keep it that way.
