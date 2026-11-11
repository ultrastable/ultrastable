# Handoff: hybrid license, specs, repo split (2026-11-11)

Done: `LICENSE` (UHL 0.9 draft), `LICENSING.md`, `COMMERCIAL-LICENSING.md`, `NOTICE`, `docs/legal/LICENSE-REVIEW.md`; `specs/` 00-12; `repo-split.json`, `scripts/split_repos.py`, `scripts/check_license.py`, `scripts/test_license.py`, `docs/REPO-SPLIT.md`; patent drafts archived (`ip/ARCHIVED.md`); memory, confidentiality, project instructions, doctrine (`licensing` block, `foundation/doctrine.py`) updated; provisional pre-flight removed from `checks`, license check added (no new workflow).

Open follow-ups (each needs an issue; defaults in effect):
1. Move extension content (patent-filing cases BC-1/BC-2 in `seed/bootstrap/cases.json`, `foundation/filing.py` and `jurisdictions.json`, funding/outreach roles in the default seed) out of the default kit; add a core-must-not-import-extension check (spec 00).
2. Social guard gate `provisional_filed` (`social/gate.json`, `scripts/social_lib.py`) still blocks AFTER FILING content; redefine it as `released` once the repos are published.
3. `ip/` rename to `archive/patent/` (links in business docs and kit/ point at `ip/`; banner used instead).
4. Generate the specification pack from the interview (spec 08) and build the three-screen interface (spec 09).
5. Create `ultrastable/workers`, `portable`, `specs` (org token) and push `split_repos.py build` output.
6. Counsel review; owner sign-off; entity assignment.
