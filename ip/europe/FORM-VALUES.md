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

## 4. The Dutch filing set (built, in `filing-nl/`)

Built by `python3 ip/europe/tools/build_nl.py` from the unchanged technical text of `ip/provisional/provisional-specification.md`; `tools/preflight.py` fails if it goes stale.

| Upload | File | Format facts |
|---|---|---|
| Description | `filing-nl/beschrijving.pdf` (pages 1 to 90) and Claims `filing-nl/conclusies.pdf` (page 91); the combined `filing-nl/beschrijving-en-conclusies.pdf` is the same 91 pages | A4; margins 2 cm top, right, bottom and 2.5 cm left, writing-free; pages numbered 1 to 91 continuously, the claims (conclusies) carrying on from the description; description in English, claims in Dutch |
| Abstract | `filing-nl/samenvatting.pdf` | English (same language as the description), 133 words (limit 150), text only |
| Drawings | `filing-nl/tekeningen.pdf` | 33 sheets, one per figure, A4 portrait or landscape; **no text labels**, only reference numerals and "FIG. n"; the labels moved to the LIST OF REFERENCE SIGNS at the end of the description |
| Request form | values in section 1 | entered in the Online Filing screens (walkthrough section 3) |

Changes from the US package (technical content unchanged): US-provisional front matter and the sentence "Claims are not required in a provisional application" removed; "claim-style summaries" renamed "numbered statements of aspects"; list of reference signs added (482 signs); abstract trimmed from 152 to 133 words; text labels stripped from the drawings; the 3 Dutch claims added.

## 5. Dutch claims: what they are and the caveat

`conclusies-nl.md` holds three claims, a faithful Dutch rendering of summary claims 1 to 3 (method, system, medium). **The translation was made by an AI agent and has not been checked by a Dutch-speaking patent professional.** Priority rests on the description, not on this wording, so a rough claim does not harm the priority date. Have a Dutch speaker or the attorney read it if you can; the preflight check confirms only that its clause structure mirrors the English.

## 6. Open items that remain (flagged, not hidden)

- NL procedure fee amount: not on any page that could be read (`FEE-TABLE.md`). Read it at payment or ask OCNL.
- Whether Online Filing registers a private person resident abroad; payment sequence; procedure fee shown only in the portal (`SELF-FILING-WALKTHROUGH.md` section 8).
- UK address-for-service (fallback route only).
