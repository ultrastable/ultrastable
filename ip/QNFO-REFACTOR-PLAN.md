# Plan: move claim-defining logic out of qnfo-workers into the private Ultrastable repo

Date 2026-11-10. Owner direction: mitigate the public-disclosure risk by refactoring so that claim-defining logic lives only in the private repo. Nothing in this plan has been executed; qnfo-workers is untouched.

## Honest limits (read first)

- Git history, forks, clones, GitHub's cache and web archives stay public. Everything in ip/DISCLOSURE-INVENTORY.md remains prior art as of its commit dates. This plan limits FUTURE disclosure; it does not erase past disclosure and it does not restart any grace period.
- Do NOT rewrite or force-push history to "hide" files: it does not remove copies, it breaks every fleet SHA reference, and an attorney may later want the original dates intact. Do not delete files from the public tree without the attorney's agreement; a deletion commit is itself a public diff.
- Public CI logs are public text. Any private SQL or code that a public workflow prints (apply-migrations, deploy-gate, pr-checks) is a new disclosure. Every step that handles private artifacts must run with output suppressed and must not echo file contents or diffs.
- Pull-request workflows from forks get no secrets. Private-artifact fetch must be gated to pushes on main and to trusted branches.
- Time order matters: freeze first (step 0), then move.

## Mechanism (consume a private artifact; publish nothing new)

1. Private repo `ultrastable-core` (this repo's `platform/` tree) builds versioned artifacts on tag: `core-sql-<ver>.tar` (migrations and seed SQL), `guard-<ver>.js` (bundled worker module), `scripts-<ver>.tar` (Python CI scripts). Artifacts are stored in a private GitHub release or a private R2 bucket.
2. qnfo-workers keeps only thin stubs: a worker entry (`export { default } from "./vendor/guard.js"` where `vendor/` is created at deploy time and is git-ignored), and a CI step that downloads the artifact using a token held as a repository secret, verifies its sha256 against a pin in a public file (the hash discloses nothing), and writes it to `vendor/`.
3. Deployment from the canonical path (qnfo-ops `/ops/deploy`) must receive the bundled module, not a repository path. The deployed Worker contains the code (Cloudflare workers are not publicly readable) but the repository does not.
4. Rule for all new claim-relevant work from now: develop in the private repo only; qnfo-workers receives artifacts.

## Ordered steps

| # | Step | Detail | Done when |
|---|---|---|---|
| 0 | Freeze | Add a CODEOWNERS or CI rule that fails a pull request to qnfo-workers touching the "move" paths below unless the change is a stub or artifact pin. Stop writing migration headers that explain claim logic in prose (the management-personas header is the model of what not to publish). | A PR touching a move path fails pr-checks |
| 1 | Parameterise | Replace QNFO constants in the copied files (platform/cloudflare-reference/PROVENANCE.md lists them) with a tenant config read from env or a config file: D1 ids, hosts, repo, worker names. This is boundary.json phase P3. | The reference files run against a different tenant config in a test |
| 2 | Pin tests | Copy the existing tests of each moved module into the private repo (list per row) and run them in both repos until step 8. | Green in both |
| 3 | Move E (change path) | See table | Deploy of a test worker passes through stub, probe revert still fires |
| 4 | Move C and D registries | See table | Metric refresh and calibration produce identical rows on a shadow D1 |
| 5 | Move A and B manager SQL | See table | Hourly management-personas run produces identical allocations on a shadow D1 |
| 6 | Move boundary and kit | See table | product_boundary check green with stubs |
| 7 | Rotate the public prose | Replace claim-explaining headers in the public tree going forward only (new migrations use a one-line header and a private design reference). Old files stay. | No new public commit adds claim prose |
| 8 | Retire duplicates | After a full fleet cycle (24 h) and attorney sign-off, remove the moved sources from the public tree by an ordinary commit (not history rewrite), keeping stubs. | Public tree contains stubs only for moved paths |

## Per-file disposition

Legend: MOVE = source becomes private, qnfo-workers consumes the artifact. STUB = qnfo-workers keeps a minimal wrapper. KEEP = remains public (QNFO app code or generic infrastructure with no claim element).

| File (qnfo-workers) | Families | Disposition | Tests to keep green | Fleet risk |
|---|---|---|---|---|
| qnfo-deploy-guard/worker.js (leases, fence, kill switch, deploy lock) | E, 44 | MOVE (bundle), STUB entry | qnfo-deploy-guard/kill-switch-fence.test.mjs (24 checks), scripts/cf_ops_killswitch_test.py, deploy-guard probes.json | HIGH: every agent lane takes a work claim here; a bad artifact stops all claims. Roll out as a new version through canonical-deploy with the probe baseline; keep the previous version for revert. Claims held across the cut stay valid (same D1 table `work_claims`). |
| scripts/canary_revert.py, deploy_probes.py | E | MOVE, STUB runner invoked by canonical-deploy.yml | their built-in self-tests (each has an embedded test block) | HIGH: the revert path must keep working if the artifact fetch fails; stub falls back to the pinned last artifact cached in the runner, and fails closed (no deploy) otherwise. |
| scripts/review_gate.py | E | MOVE | embedded tests; pr-lane.yml | MEDIUM: gate is `observe` by default; failure must not block merges (matches current behaviour, claim 39). Log output must not include diffs. |
| scripts/claim_reaper.py, worker_release.py | E | MOVE | embedded tests | LOW |
| scripts/apply_migrations.py | E, all SQL | KEEP as generic runner, but add private-migration source and silence output | scripts/apply_migrations_test.py, apply_migrations_overload_test.py | HIGH: workflow apply-migrations.yml applies SQL; public log must not print private SQL; ordering with public migrations must be by filename date. |
| migrations/2026-10-02-work-claims.sql, 2026-10-28-bp26-leases-killswitch.sql | E | MOVE (already applied; history stays public) | migrations tests (`*.test.mjs` for killswitch-caps-1) | LOW once applied; new schema changes go private. |
| migrations/2026-10-12-20-kernel-registries.sql, -22-calibration-scorer.sql | C, D | MOVE going forward; applied rows stay | doctrine-ledgers-20261012.test.mjs, ab-length-retry.test.mjs (reads the decision_predictions DDL from the file: update path) | MEDIUM: tests read these files by path; a stub path or fixture copy is needed. |
| migrations/2026-10-12-21-tick-driver-roster.sql, 2026-10-26-management-personas*.sql, 2026-11-04-north-star-managers.sql | A | MOVE going forward | management-personas*.test.mjs (about 10 files) | MEDIUM: `fleet_tasks` definitions (the manager steps) are DATA in D1; changes ship as private migrations. |
| migrations/2026-10-29-plussing-1.sql, plussing-4.sql, plus-* migrations, docs/PLUSSING.md | B | MOVE going forward; replace PLUSSING.md with a one-page public product description | plus-*.test.mjs, plussing-*.test.mjs | MEDIUM |
| migrations/2026-10-08-autonomy-first.sql, 2026-10-12-34-default-adopt-prediction.sql, recall-loop.sql | C, H | MOVE going forward | recall-loop.test.mjs | LOW |
| qnfo-fleet-control/worker.js anchors: evaluateMetricTriggers 15908-16040, loopWatch 8710, remediationContractsTick 12823, cmTrusted 3617, fleet_tick second source 12355-12374 | A, C, 41 | Extract by refactor into modules `core/*.mjs` (private), STUB imports | qnfo-fleet-control tests (scoped by feature), loop-watch tests | HIGH: 1.4 MB single file with research steps in the same module; refactor in small PRs, one function per PR, with a shadow tick before the switch. |
| qnfo-fleet-dashboard/worker.js manager and plus API 18832-19001 | A, B read side | KEEP for now (reads only; no claim logic) | dashboard tests | LOW |
| qnfo-ai/worker.js model ladder 33, 82-106, 362-400 | 45, 93 | Extract later (lowest claim weight); KEEP until needed | router tests listed in qnfo-ai/ (spend-*.test.mjs, router-resolve) | MEDIUM |
| scripts/product_boundary.mjs, product/boundary.json | F | KEEP public (already published 2026-11-10); the tenant-config and kit schema are NEW and stay private | the check itself | HIGH if boundary.json lists a MOVE file that no longer exists: update `core_scripts` to list stubs |
| docs/AUTONOMOUS-OPERATION-DOCTRINE.md, DOCTRINE-KERNEL.md, AUTONOMY-DECISION-POLICY.md, ENSEMBLE-POLICY.md | C, D, E, H | KEEP (already public); add nothing claim-specific | agents-md-rules.test.mjs, claude-md-rules tests | LOW |
| CLAUDE.md, AGENTS.md, .claude/settings.json | H | KEEP; the deny-list consistency test and policy store stay private (rc seed/) | scripts/claude-md-rules.test.mjs | LOW |
| G bootstrapper (rc seed/bootstrap), seed worker, policy.json, tenant kit, idea-to-backlog generator | G, H, F, newer 105, 127 | NEVER published; stay private; do not add to qnfo-workers in any form | rc seed/tests | none |

## Fleet CI and deploy risks, by system

- **canonical-deploy.yml** and qnfo-ops `/ops/deploy`: take the lock, deploy a worker from a repo path. They must be taught to build `vendor/` from the pinned artifact first. Risk: the deploy hashes the repo path, so the drift check (deploy-drift.yml) will see a mismatch unless the hash is computed over the bundled output. Test on one low-impact worker first.
- **Work claims** (qnfo-deploy-guard): the guard is the component being moved. Acquire a work claim for each moved file before editing it (fleet convention), expect other agents' claims on the same paths, and shepherd rather than duplicate. Tokens and fences live in D1 and are unaffected by the code move.
- **Boundary check** (scripts/product_boundary.mjs): fails on an unclassified live worker. Stubs keep worker names, so classification is unchanged; remove moved files from `core_scripts` only after the stubs land.
- **Migration guard and apply-migrations**: the guard workflows expect migrations in the repo with header lines (`APPLY-BY`, `DB`, `Rollback`). Private migrations need the same headers and a numbering authority so dates never collide.
- **Self-audit gate (SELF-AUDIT-1)** on every PR body: unchanged; extra PRs add work.
- **Secrets**: the artifact-fetch token is a new standing credential: store as a repository secret, scope to read one private repo, do not print.
- **Tests that read files by path** (for example ab-length-retry.test.mjs reads the calibration migration; plus-substrate-reconcile tests read migration text): move the tests with the file or give them a fixture.

## What this does not fix

- Disclosed material stays disclosed (see DISCLOSURE-INVENTORY.md). Whether the 2026-10-26 to 2026-11-10 public SQL headers and PLUSSING.md damage foreign rights is for the attorney.
- The product page ultrastable.io and docs/PRODUCT-ULTRASTABLE.md keep describing the product; keep them at benefit level and do not add mechanism.
- Public worker behaviour is still observable from the deployed Workers (HTTP surfaces such as /api/managers on fleet.qnfo.org). Review those endpoints for claim-revealing output (allocation formulas, trust ladders) before the attorney's filing date.

## Execution status (2026-11-10)

- Step 1 (parameterise) DONE for the reference copies in `platform/cloudflare-reference/scripts`: `tenant.py` supplies hosts, private databases, health URL, repo, canary workers, ledger DB id (`ULTRASTABLE_TENANT` JSON file; empty and strict by default). Verified with `tenant.qnfo-selftest.json`: `deploy_probes.py --selftest` ok (80 checks), `review_gate.py --selftest` ok (41). `canary_revert.py --selftest` passes 39 of 40; the one failure reads each worker's `probes.json` from the fleet repo, which is not part of the reference tree (passes in qnfo-workers, 40 checks). Without a tenant file the defaults deny every host, so 7 deploy_probes checks that assume QNFO hosts fail by design. Remaining QNFO literals sit only inside self-test fixtures and `qnfo-deploy-guard/worker.js` (URLs, lines 3, 16-17), still to parameterise.
- Step 0 (freeze) NOT executed: a public CI rule that lists the "move" paths would itself publish which files carry claim logic. Implement it as a check shipped inside the private artifact (step 3 mechanism), or as a CODEOWNERS entry using only directory names, after attorney review.
- Steps 2-8 not started: they change qnfo-workers, which auto-deploys; each needs a work claim and a shadow run first.
