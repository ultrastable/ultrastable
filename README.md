<p align="center"><img src="brand/social/readme-banner.png" alt="Ultrastable" width="100%"></p>

# Ultrastable (private)

The self-governing development platform: a control loop around coding agents that finds its own work, hands it to the agent that fits,
proves each change live with automatic revert, and scores its own decisions. Proprietary. QNFO is customer zero (a customer, not the owner of this code path).

- `site/` public site worker for ultrastable.io (.app, .net redirect). Tests: `node site/site.test.mjs`. See HANDOFF.md for state, decisions and blockers.
- `core-manifest/` which parts of the QNFO fleet are the product (core) vs QNFO applications vs personal; the extraction map (phases P1-P4).
- `qnfo-platform-thread/` everything the QNFO thread "Position QNFO as autonomous development platform" produced: product doc, boundary manifest, claim checks, platform page source, migrations, tests, the 12 merged PRs as patches, D1 state, thread text. Index: its README and MANIFEST.md; check with `python qnfo-platform-thread/verify.py`.
- `local-workspace/` copy of the owner's local folder `C:\Users\LENOVO\Dev\ultrastable` (patent drafts, planned repos, git bundles).
- `docs/` business documents: product and positioning, market read. Add: pitch, financial model, pilot terms, IP assignment record.

Status: bootstrap copied from QNFO/qnfo-workers on 2026-11-10. Extraction of core workers (P2-P4) is tracked as issues in this repo.
