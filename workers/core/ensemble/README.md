<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/ensemble: cross-model proposals, verification and automatic updates

Tenant-agnostic. First run by a tenant test bed; every Ultrastable system can use it by passing its own pool and rules. Status: BUILT unless marked.

| Piece | Status |
|---|---|
| Pool and channels: one vendor per panel seat, lineage or vendor overlap above `channel_overlap_max` refused, the author's family never in the pool (`candidates`, `askPanel`, `overlap`) | BUILT |
| Proposals from fetched source text, never recalled (`fetchSources` Europe PMC by default; any provider via the `sources` port), `proposalPrompt`, `parseProposal` | BUILT |
| Deterministic evidence checks before any vote: editable field, verbatim quote, numbers in the source, size bound, markup, exactly-once file match (`evidenceChecks`, `swapLiteral`) | BUILT |
| Adjudication: unanimous support from at least `min_verifiers` distinct vendors applies; a split or unclear vote is uncertainty; an outage is pending, never applied (`adjudicate`) | BUILT |
| Measured correlation: effective votes from verifier verdicts, benching of the most correlated vendor, health ordering of failing models (`effectiveVotes`, `flaggedIds`) | BUILT |
| One bounded run with a ledger, failures recorded per model (`ensembleRun`, `ledgerView`, `genModule`) | BUILT |
| Cross-vendor review of an agent's code diff before merge (`review.js`): a tie or majority of rejects blocks; fewer than two answers proceeds and records the gap | BUILT |
| Path guard so governed models cannot edit the rules that govern them (`scope.js`) | BUILT |
| Free keyless routes: GitHub Models on the run's token, Workers AI through a tenant model Worker on the run's OIDC token (`routes.js`) | BUILT |
| Applying a change (branch, test, pull request, merge, deploy, settle revert) and the page that shows uncertainty | tenant code: `tools/ensemble.mjs`, `worker/src/ensemble-view.js` in the tenant repository; a generic runner is NOT COVERED |
| Pool and rules | the tenant's `ensemble-config.js`; `core/ensemble` names no model |

Lessons from an earlier fleet ensemble policy carried into this module: correlated judges are worth fewer votes than they number, so panels are small and cross-family; the writer's family never judges; deterministic layers run first and are never removed to make room for a model layer; the correlation is measured and acted on. Difference on purpose: that policy failed open for publishing; this module fails closed for changing a record, because an outage must never apply an edit.
