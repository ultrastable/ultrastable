# File this today

The provisional is complete and checked. Filing is Rowan's act (identity-bound: signature and fee). It takes about 20 minutes.

1. Verify the filing account once: https://account.uspto.gov (ID.me). Do this first; it is the only step with a wait.
2. Run `python3 ip/provisional/tools/preflight.py`. It must end `0 failures`.
3. Follow `filing/PATENT-CENTER-WALKTHROUGH.md`. Upload `provisional-specification.pdf` and `drawings.pdf`.
4. Type the five values `filing/cover-sheet-PTO-SB-16-data.md` marks bold (family name, residence, mailing address, email; signature).
5. Fee: $65 micro or $130 small (see `filing/FEES-AND-ENTITY.md`).
6. Save the filing receipt and tell the fleet; the fleet records it and unlocks the post-filing items.

What is in the package

| File | Role |
|---|---|
| `provisional-specification.pdf` / `.md` | The specification: 137 pages, 139 claim-style summaries in 11 families, abstract |
| `drawings.pdf` | FIGS. 1 to 33 |
| `filing/ads-data.json`, `filing/cover-sheet-PTO-SB-16-data.md` | Cover sheet values, prefilled |
| `filing/FEES-AND-ENTITY.md` | Fee and entity notes |
| `filing/PATENT-CENTER-WALKTHROUGH.md` | One-page filing walkthrough |
| `tools/preflight.py` | Claim numbering, figure references, wording, placeholders, PDF currency, `external/` confidentiality |
| `CLAIM-STRATEGY.md`, `FILING-CHECKLIST.md`, `QA-STATUS.md` | For the attorney (optional before filing; recommended before the 12-month conversion) |

Open attorney question (not a blocker to filing): what, if anything, in the public QNFO repository (QNFO User License Agreement v2.1; a separate effort) overlaps with the combination claimed here, and when. The specification asserts nothing about prior disclosure.

A provisional supports only what it describes. Anything built later and worth claiming goes into a new provisional or the 12-month non-provisional.
