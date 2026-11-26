<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# adapters/github: issue steward and merge host

`steward.js`: mirrors items to every sink (`githubSink` REST issues, `fileSink` plain files; a failing sink never blocks the other and is retried), flags items missing owner role, done check or closing probe, and provides `githubMergeHost` for `core/codeloop`. Token by env name only.

Owner role: operations. Trigger: every tick (bounded to 50 items). Closing probe: `steward_mirror` has no row with `last_error` older than two sweeps; `flagged` is empty. `mirror` and `hygiene` are the implementation in `core/steward/index.js`, re-exported here (one copy; an adapter may import core, never the reverse). Status: BUILT (`steward.test.js`; one test shows the adapter and the core write identical hashes). Pull-direction sync is covered only for issues that exist solely on the tracker (`stage2.js` `adopt`); edits to an existing issue do not flow back into the item, and labels are not mirrored: NOT COVERED.

`stage2.js` (US-SPEC-20 stage 2): `githubTracker` (paged, bounded read of open issues; comments; decision issues), `mirrorClaims` (each claim in the store as a `claim:` comment, once), `mirrorDecisions` (each kernel decision as its own issue, closed when settled), `adopt` (an issue that exists only on the tracker becomes an item) and `stage2Probe`, the stage's evidence: items in the store match open issues. An unreadable or partly read tracker is `unknown`. Status: BUILT (`stage2.test.js`). Wired into the organization's tick as the step `stage2` in `core/org/surfaces.js` (on by default, skipped without `config.vcs.repo` and the token; `core/org/surfaces.test.js`); not running on a live account.

`pulls.js`: `githubPulls` reads merged pull requests with their files and labels (paged and bounded; `complete` is false when a bound cut the read short) for the self-hosting measures in `core/steward/measures.js`. Status: BUILT (`pulls.test.js`, fake fetch only).
