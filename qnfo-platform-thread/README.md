# QNFO platform thread: everything it produced

This folder holds every file, code change, configuration and text the project thread "Position QNFO as autonomous development platform" (2026-11-10) produced, so nothing lives only in chat. Private: part of `ultrastable/ultrastable`.

Start here:
- `thread/transcript.md`: the owner's messages verbatim, the results, decisions and final checklists.
- `vendor/qnfo-workers/docs/PRODUCT-ULTRASTABLE.md`: the product definition, name, pitch, spin-off plan (phases P1-P4).
- `vendor/qnfo-workers/product/boundary.json` + `scripts/product_boundary.mjs`: which fleet parts are product core, QNFO apps, personal.
- `vendor/qnfo-workers/qnfo-gateway/excerpts/platform-page.js`: source of qnfo.org/platform and the ultrastable.io routing (full gateway worker beside it).
- `vendor/qnfo-workers/migrations/2026-11-10-ultrastable-*.sql`: the claim checks (`product_claims`), owner questions (`owner_asks`), owner cards (`human_actions`), link-target config (`product_profile`).
- `vendor/qnfo-workers/qnfo-gateway/platform-claims.test.mjs`, `scripts/product-boundary.test.mjs`, `scripts/product_claims_probe_guard_test.py`: the tests.
- `vendor/resume`, `vendor/rwnq8.github.io`, `vendor/rwnq8`: brand doc section 9, CV and PDF, website, GitHub profile as merged.
- `patches/`: the exact merged commit of each of the 12 PRs (`git am`-able).
- `live-state/`: D1 rows at copy time. `memory/`: project memory notes. `library/design-standards/`: the project Library screenshots.

Live: https://qnfo.org/platform, https://qnfo.org/api/platform-claims, https://ultrastable.io, owner questions on https://fleet.qnfo.org/focus.

The vendored files are copies; the deployed versions stay in their repos (commits in `MANIFEST.md`). `python verify.py` checks that every inventory item is here and unchanged.
