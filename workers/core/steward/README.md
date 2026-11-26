<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/steward: the item ledger mirrored to every tracker (US-SPEC-08)

`mirror` pushes each changed item to every configured sink (no single route; a failing sink never blocks the others). `unplaced` lists open items missing on a sink, `stuck` lists mirrors that never succeeded, `rollup` counts items for the console, `steward` runs the cycle, records a `steward_runs` row and files one deduplicated item (`STW-<item>-<sink>`) per stuck mirror. Sinks are ports (`{ name, upsert }`); the GitHub and file sinks are in `adapters/github/steward.js`.

Owner role: operations. Trigger: every tick. Closing probe: `unplaced()` and `stuck()` are empty. Status: BUILT (`steward.test.js`). Pull-direction sync (tracker edits back into items): NOT COVERED, blocked on a conflict rule (see `ops/extraction-unblocked.json`).

`stage.js` (US-SPEC-20 s4): `computeStage` reads the self-hosting ladder (stages 0 to 4) from the organization's own tables and injected probes, never from a declaration. A stage holds only when its evidence and every lower stage's hold; a stage is *claimed* only when the probe's author differs from the stage's author; `checkPublished` fails a published stage above the computed one; `stageStep` is a tick step that records the stage and files `STAGE-<k>` for the first stage without evidence. Status: BUILT (`stage.test.js`). Not registered in `core/org` yet (an integration request).

`measures.js` (US-SPEC-20 s6): contract coverage, spec truth, execution ratio, self-review rate and protected-change reviews from a merged pull request list (`adapters/github/pulls.js`); an absent input is `null` with a reason, never 0. Its record rules are a port of `tools/selfhost_check.py`, kept equal by a parity test. Status: BUILT (`measures.test.js`).
