# Ultrastable IP: provisional patent application (private)

Draft US provisional patent application for Ultrastable: an organization run by a hierarchy of virtual manager agents with closed feedback loops, scored predictions, earned autonomy, plussing and bootstrapping from a seed. Drawn from the QNFO fleet (customer zero). Draft for attorney review, not legal advice. Keep this repository private.

## Files

| File | What |
|---|---|
| `provisional-specification.md` | The specification source (draft version 5): field, background, summary, 33 drawings described, definitions, data model, algorithms, worked examples, alternative embodiments, 139 claim-style summaries in 11 families with a claim-to-section table, abstract |
| `provisional-specification.pdf` | The specification as filed in Patent Center (built from the .md) |
| `drawings.pdf` | FIGS. 1 to 33, informal drawings |
| `QA-STATUS.md`, `review/` | Own patent-quality review: what was run, what was applied, open items |
| `figures/fig01..fig33-*.svg` | Drawing sources |
| `figures/figs.py`, `figures/src/figs_*.py` | Generator for the drawings (`python3 figures/figs.py figures`) |
| `CLAIM-STRATEGY.md` | Memo for the attorney (not for filing): the key distinguishing claims, technical effects, nearest prior art, claim-to-spec support table, review items |
| `FILING-CHECKLIST.md` | Public-disclosure deadline, inventorship, entity status and fees, Patent Center documents, before-filing edits, post-filing deadlines |
| `tools/build.sh` | Rebuilds both PDFs (pandoc and headless Chromium) |

## Status

- 2026-11-10: draft version 5: expanded with sections 23 to 59 (kernel, fleet, origination, model economics, audit, seed, owner console, self-description, autonomous business chain), FIG. 16 to 33, claims rewritten after own QA review (see QA-STATUS.md). Earlier: version 2 complete. Not filed. Bootstrapping embodiment ([0078a] to [0078j], FIG. 15, claims 47 to 57) added from the seed and AIOS thread. Next steps: attorney review, then Rowan files (identity-bound step).
- Timing: file as early as practical. Open question for the patent attorney (not a finding): what, if anything, in `QNFO/qnfo-workers` (separate effort, governed by the QNFO-ULA v2.1) overlaps with the combination claimed here, and when.
