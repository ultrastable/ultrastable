# What was cut to reach 100 sheets (2026-11-10)

Owner directive 2026-11-10: the provisional must be 100 pages or fewer. The USPTO application size fee (37 CFR 1.16(s)) counts the specification and the drawings together, so the limit is applied to the combined count.

| | Before | After |
|---|---|---|
| Specification PDF | 137 pages | 83 pages |
| Drawings PDF | 17 pages (33 figures) | 17 pages (33 figures, unchanged) |
| Total sheets | 154 | 100 |
| Words, sections 23 to 59 | 49,848 | 25,616 |
| Numbered paragraphs | [0001] to [0482] | [0001] to [0233] |

Layout is unchanged (11 pt Times, 1.3 line height, Letter, 1 in margins). Nothing was shrunk by typography.

## What was kept
- Front matter, background, summary, brief description of the drawings and sections 1 to 22 ([0001] to [0092]) unchanged, except three sentences added so every reference numeral drawn in FIGS. 6, 13 and 14 is named in the text (a pre-existing gap).
- All 139 claim-style summaries, verbatim. Every claim element was checked against the condensed sections 23 to 59.
- The abstract (150 words).
- Section numbering 1 to 59, and every subsection that text elsewhere cites.
- Every reference numeral of FIGS. 16 to 33. The FIG. 26 numerals 2616 to 2628 were corrected to match the drawing (the earlier text had them out of step).
- Definitions, mechanisms, alternatives and stated technical effects that support the claims.

## What was removed or condensed (sections 23 to 59)
- Status lines ("built", "live since", dated observations) except where a claim relies on a built part.
- Measured figures and dated anecdotes from the fleet, except the short audit examples in section 39 and the loop-breaker figure in section 41.
- Most code blocks; schemas were kept inline as column lists. One SQL example kept (section 41).
- Tables 39-1, 41-1 and 51.2, the dashboard page table (section 30) and report-card numbers.
- Route lists and per-worker inventories (sections 27, 30, 47).
- The suggestion engine detail (section 34), keeping experiments, roadmap proposals and inferred direction.
- Duplicate prose between sections 19A, 43 and 56 (review cuts G5, G6, G7, G9 of `review/description-review-2026-11-10.md`).
- Section 58's worked example shortened to one paragraph; section 59 kept as a short evidence index.
- Subsection headings were dropped where the condensed text is short, mostly in sections 44 to 58; their text runs on under the section heading. Subsections cited elsewhere keep their numbers (for example 43.4, 44.2, 44.3, 46.2, 53.3, 57.1, 57.2, 57.4, 57.8), so some sections skip a number. Two were renumbered to close a gap: 32.3 became 32.2 and 34.2 to 34.4 became 34.1 to 34.3. The text of 43.6 (limits of the seed as built) is now in 43.5.

## What moved
- The claim-to-section cross-reference table moved from the end of the specification to the appendix of `CLAIM-STRATEGY.md` (it was never part of the claims). `tools/preflight.py` reads it there.

## What this means
- A provisional supports only what it describes. Matter removed here is not covered by this filing. The full 137-page text is kept, unchanged, in `archive/v5-137pages/` (markdown and both PDFs). Anything from it worth claiming can go into a later provisional or the 12-month non-provisional.
- Paragraph numbers after [0092] changed. Memos that cite paragraphs above [0092] should cite sections instead.

## How the limit is enforced
- `tools/build.sh` (and the two kit copies) print the combined sheet count and exit 1 above 100.
- `tools/preflight.py` fails above 100 sheets and also fails when a reference numeral in a drawing is never mentioned in the text. CI (`.github/workflows/checks.yml`) runs preflight on every push.
