<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-17: Failure-mode register, remediation contracts and loop breaker

| Field | Value |
|---|---|
| ID | US-SPEC-17 |
| Title | Failure-mode register, remediation contracts, loop breaker, silent-drop and roster reconciliation |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

An autonomous system's characteristic failures are silent: a loop that reports zero errors while repairing nothing, a monitor that cannot see its own stop, a fix that lands in a repository and never in production. This specification defines a register of named failure modes with scheduled detectors, a remediation contract attached to each work item, a breaker that stops repeating retries, and reconciliations that find what fell through.

## 2. Terms

| Term | Definition |
|---|---|
| Failure mode | A named way the system fails, with a detector, threshold and severity. |
| Detector | A statement or probe returning a count, ratio or set, evaluated on a schedule and compared with a threshold. |
| Remediation contract | A record on an item: owner, doer, trigger, closing probe, retry bound, deadline. |
| Outcome bucket | One disposition of a scanned item: `executed`, `failed`, `needs_human`, `no_action`. |
| Loop breaker | A procedure that files a root-cause item when a signature repeats. |
| Half-open probe | A single scheduled retry after a breaker opens. |

## 3. Register and detectors

```sql
CREATE TABLE failure_modes (
  id TEXT PRIMARY KEY, name TEXT, surface TEXT,
  detector_sql TEXT NOT NULL, fire_when TEXT NOT NULL,   -- e.g. 'value < 0.8*expected'
  severity INTEGER, contract_id TEXT, first_seen TEXT, last_fired TEXT,
  status TEXT DEFAULT 'armed');
CREATE TABLE failure_mode_hits (
  fm_id TEXT, ts TEXT, value REAL, expected REAL, fired INTEGER, evidence TEXT);
```

Each detector runs on a schedule (default hourly) and writes one hit row whether or not it fires, so an armed detector that stops producing rows is itself detectable.

| Id | Detector summary | Fires when | Audit instance |
|---|---|---|---|
| FM-COVERAGE | Distinct names in the probe log in the last hour | below 0.8 of registry names | 10 names against 82 observed earlier: 0.12 |
| FM-MASKED | Rows with status `ok` whose payload says `ok` false or names an exception | count above 0 | 19 drain rows with the failing payload |
| FM-UNBOUNDED-RETRY | Same (target, error) in the deploy ledger without a state change | 3 attempts | 26 and 25 attempts for two targets |
| FM-SHADOW | Two candidate sources for one worker with differing hashes and a stale earlier candidate | any | stale mirror over a fresher file |
| FM-UNACCOUNTED | scanned minus sum of outcome buckets | above 0 | 25 minus 0 = 25 |
| FM-FROZEN | measured now minus newest write of a table, over its interval | above 2 | 13.65 min / 15 = 0.91, not fired |
| FM-ROSTER | Symmetric difference between registry, scan set, probe set, emitter set | any | emitter not in the 55-name registry |
| FM-STALE-PREDICATE | An alarm's population differs from the population it names | any | alarm on 496 stuck `new` while live `new` was 0 |

The FM-FROZEN detector takes the clock in the same statement as the data, so a clock error cannot occur:

```sql
SELECT (julianday('now') - julianday(MAX(replace(ts,' ','T')))) * 1440.0 AS age_min,
       15.0 AS interval_min
FROM fleet_probe_log;  -- fire when age_min / interval_min > 2
```

A detector can itself be wrong: a classifier that marked an event `error` on the substring `failed` classified `{"queued":0,"failed":2,"published":19}` (where 2 is a count) as a failure. A detector whose firings are confirmed by verification in under a threshold share (default 50% over 10 firings) is set to `probation`. Because a monitor cannot detect its own stop, one detector is hosted in a different worker than the one that writes the probe table.

## 4. Remediation contract

```json
{ "item": "queue-version-error", "severity_rank": 2, "category": "queue",
  "owner": "queue-agent", "auto_actionable": true,
  "remediation": { "suggested_action": "queue-drain",
    "doer": "backlog-exec", "trigger": "on_fire",
    "closing_probe": "SELECT COUNT(*) FROM version_queue WHERE status='error'",
    "pass": "= 0", "max_attempts": 3, "backoff_h": [1,4,24], "deadline_h": 72 } }
```

A firing detector opens an item with its contract. A consumer picks items in severity order, invokes the doer and books exactly one outcome bucket per scanned item. It runs the closing probe; on pass the item closes with the evidence row, a prediction is scored if present and the register updated. On fail the item is retried at the next backoff step up to `max_attempts`, then becomes `needs_human`, routed through the interrupt gate only if interrupt-eligible, otherwise reassigned to another doer.

## 5. Loop breaker

Count attempts per (target, error signature). At k (default 3) suspend the target's retry, file a root-cause item to the target's program and schedule a half-open probe at a longer interval (default 24 hours); a pass closes the breaker, a fail extends the interval.

**Counterfactual (computed from audit counts).** A deploy ledger had 76 rows, 54 failed (71%); 26 came from one target (a downgrade loop with one error code each hour) and 25 from another (a syntax error against a corrupt canonical file): 51 of 76 rows (67%) and 51 of 54 failures (94%). A breaker with k = 3 permits 3 failed attempts per target: 26 - 3 = 23 and 25 - 3 = 22, so 45 of the 51 repeated attempts (88%) would not have been made. Alternatives: backoff doubling from 1 hour to a cap of 24 hours (attempts at hours 0, 1, 3, 7, 15, 31, 55); re-arm when the target's source hash changes; route to a different doer after k failures.

## 6. Reconciliations

**Silent drop.** Each consuming loop reports per run `scanned` and per-bucket counts; the reconciler tests `scanned == executed + failed + needs_human + no_action`. On a gap: open an incident, reopen the unaccounted items, block closure of their parents.

**Ledger (split brain).** Where several stores hold issues, union them by a declared key and compute the visibility ratio (open in all stores / open visible to operations tools); fire above a threshold (default 2). Observed: 303 open in a store the tools did not read against 12 in the store they did: a 25.3x under-report. A rate extrapolated from two readings 5.5 hours apart was demoted to an unreplicated estimate when a re-measure gave 303 against 305 an hour earlier, while the 25-fold gap reproduced.

**Roster.** Compare the registry, the deployed census, the scanner's accumulated set and the probe log's ghost names; add a third independent source, the set of distinct alert sources and event names observed in the period, and fire on `emitters - (registry union live list)`. An emitter missing from the registry and the live list is invisible to a check that compares only those two.

**Deploy subsystem.** When a repository fix does not ship, separate defects (a version selector that downgrades; a corrupt canonical file; a canonical copy importing a removed module) and check the deployer's resolver order: a stale mirror candidate can shadow the fixed file. A tombstone at the shadowing path changes which candidate resolves. Confirm a fix by a deciding query, not by repeated deploys.

## 7. Normative requirements

- **US-17-R01 [L2]** Each detector MUST write one hit row per run, whether or not it fires.
- **US-17-R02 [L2]** A detector that reads time MUST take the clock in the same statement as the data (US-05-R14).
- **US-17-R03 [L2]** Each failure mode MUST have a detector and a severity; a failure found twice without a detector MUST be registered.
- **US-17-R04 [L2]** A firing detector MUST open an item with a remediation contract naming owner, doer, trigger, closing probe, retry bound and deadline.
- **US-17-R05 [L2]** A consumer MUST book exactly one outcome bucket per scanned item and satisfy the accounting invariant.
- **US-17-R06 [L2]** An item closes only when its closing probe passes.
- **US-17-R07 [L2]** After `max_attempts` an item MUST become `needs_human` only through the interrupt gate if interrupt-eligible, else it MUST be reassigned.
- **US-17-R08 [L2]** A loop breaker MUST suspend retries of a signature at k repeats in a window, file a root-cause item and schedule a half-open probe.
- **US-17-R09 [L2]** A detector confirmed by verification in under a threshold share MUST be set to `probation`.
- **US-17-R10 [L3]** One detector MUST be hosted in a different worker than the one that writes the probe table it checks.
- **US-17-R11 [L3]** The reconciler MUST compute the visibility ratio across all issue stores and fire above its threshold.
- **US-17-R12 [L3]** Roster reconciliation SHOULD include the set of observed emitter names.
- **US-17-R13 [L2]** A fix asserted in a repository MUST NOT be closed on repository evidence alone (US-05-R10).
- **US-17-R14 [L2]** An item whose closing probe is a failure-mode probe MUST NOT stay closed while that probe is red: it MUST be reopened with a recorded outcome, whoever closed it and with whatever message.
- **US-17-R15 [L2]** A failure mode MAY carry an ordered list of fixes. While its probe is red the first fix not yet done MUST be filed; when every listed fix is done and the probe is still red, an escalation item that demands a different approach MUST be filed. All of them close, with evidence, when the probe is green.
- **US-17-R16 [L2]** A detector or probe that cannot run (a malformed statement, a missing tool, an unreadable source, no number returned) MUST be recorded as a finding and MUST NOT be read as healthy.
- **US-17-R17 [L2]** A metric whose last good reading is older than twice the tick cadence MUST file its own stale item, closed only by a fresh reading. The time of the last reading MUST be the time of the last good reading, so a probe that keeps failing goes stale.
- **US-17-R18 [L3]** Every server-side loop MUST leave a record before its body runs and complete it afterwards, so that a loop that threw, a loop that never returned and a loop that was never called are three different records. Per loop, the slots it should have run in MUST be counted against the slots it ran in, and a loop that did not run MUST file an item that only the same count can close.
- **US-17-R19 [L2]** A loop that returned without doing its work (it had no credential, every one of its routes failed, or it reported only errors) MUST be recorded as a failed run, not a good one.
- **US-17-R20 [L2]** The item a failing detector files MUST name the suspected root cause as evidence: the files changed between the last commit the detector passed on and the failing one, and the files its own evidence names.

## 8. Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Detector wrong | False incidents | Structured match; probation |
| Monitor cannot see its own stop | Silent outage | R10 |
| Unbounded retry | Wasted attempts, noise | Breaker |
| Registry-only roster | Invisible emitters | R12 |
| Contract retry bound and deadline not built | Endless loop | PLANNED fields |

## 9. Conformance tests

- **US-17-T01** Arm a detector that does not fire; run it. Pass: a hit row with `fired = 0`.
- **US-17-T02** Stop a detector's writes for 3 intervals. Pass: FM-FROZEN fires.
- **US-17-T03** Feed 3 identical (target, error) failures in 24 hours. Pass: retry suspended, root-cause item filed, half-open probe scheduled.
- **US-17-T04** Run a loop that scans 25 and books 0. Pass: incident, 25 items reopened.
- **US-17-T05** Emit alerts from a name absent from the registry and live list. Pass: roster reconciliation fires.
- **US-17-T06** Feed the payload `{"queued":0,"failed":2,"published":19}`. Pass: not classified as a failure.
- **US-17-T07** Close an item whose closing probe is a red failure-mode probe. Pass: the next audit reopens it and records an outcome.
- **US-17-T08** Stop one loop for a day while the others run. Pass: that loop is judged stopped, an item named for it is filed, and the item closes when the loop runs again.
- **US-17-T09** Run a detector whose tool is missing. Pass: recorded as a finding, not as a pass.

## 10. Reference implementation status

Paths in 10.1 are relative to `workers/` in the platform repository (the kit's composable modules); paths in 10.2 are relative to the platform repository root. Re-verified against the code on 2026-11-26.

### 10.1 Composable modules (`workers/`)

- In the seed: the silent-drop reconcile (item-level) and the guarded tick with `TICKFAIL` items are BUILT (`core/src/tick.js`, tests `core/test/tick.test.js`).
- Register and detectors (R01 to R03, R09): BUILT in `core/kernel/failure.js` with `core/kernel/migrations/0001_kernel.sql`; tests `core/kernel/failure.test.js` (T01, T02, T06 by id). Standard detectors (FM-UNACCOUNTED, FM-UNBOUNDED-RETRY, FM-FROZEN, FM-MASKED), registration on the second sighting of an undetected failure, and the status view: BUILT in `core/remediation/index.js` (`installStandard`, `reportFailure`, `statusView`) with `core/remediation/migrations/0001_remediation.sql`; tests `core/remediation/remediation.test.js`. FM-COVERAGE, FM-SHADOW and FM-STALE-PREDICATE are PLANNED: no module writes the probe log, deployer candidate list or alarm definitions they read. RUNNING in QNFO (about 634 failure modes with detectors, owner-reported 2026-11-10; the schema above is illustrative and the table of detectors lists audit examples that the audit procedure proposed as registrations, not rows read from the live table).
- Loop breaker as a signature rule (3 repeats in 24 hours, root-cause item, half-open probe; R08): BUILT in `core/kernel/failure.js` (`recordAttempt`, `canAttempt`; test `core/kernel/failure.test.js` T03). For a ledger whose writer has no breaker, such as the audited deployer: BUILT in `core/remediation/index.js` (`breakerFromLedger`, `retryAllowed`; test `core/remediation/remediation.test.js`). RUNNING in QNFO.
- Remediation contract with owner, doer, trigger, closing probe, retry bound (`max_attempts`, `backoff_h`) and deadline (`deadline_h`), the consumer that books one bucket per item, closure only on a passing probe, and escalation through the gate or reassignment (R04 to R07): BUILT in `core/kernel/failure.js`; tests `core/kernel/failure.test.js`. RUNNING in part in QNFO (owner, doer, trigger, probe).
- Silent-drop reconciliation across loops (the run ledgers of the kernel, claims and fleet modules; a loop that stops reporting; the item-set invariant with restore of a vanished item): BUILT in `core/remediation/index.js` (`reconcileLoops`, `reconcileItems`; test `core/remediation/remediation.test.js` T04). RUNNING in part in QNFO; the invariant did not hold in one component on 2026-09-13.
- Roster emitter-set detector (R12: `rosterReconcile`, `observedEmitters`), external liveness detector (R10: `externalLiveness`, which refuses to run inside the writer of the probe table) and closure of a repository fix on production evidence only (R13: `closeFix`): BUILT in `core/remediation/index.js`; tests `core/remediation/remediation.test.js`. Visibility ratio (R11): BUILT in `core/claims/gate.js`; tests `core/claims/gate.test.js`.
- Hosting `externalLiveness` of `core/remediation` in a second deployed worker (R10 in operation for that module): PLANNED. It needs a live account; the check and its refusal to run in the writer are built. The running kit has its own second producer (10.2).
- Not wired: `core/remediation/index.js` has a `step` surface that the composition root runs (`core/org/buildout.js` step `remediation`, test `core/org/org.test.js`). The second-worker hosting of `externalLiveness` stays PLANNED.

### 10.2 Running kit and platform (`seed/`, `foundation/`)

Two registers run today, both more developed than the schema of section 3 in what happens after a detector fires. Neither uses the tables `failure_modes` and `failure_mode_hits`; their records are named below.

- Kit register and tick step (R01, R03, R04 in part, R06, R14, R15, R16, T01, T07): BUILT in `seed/worker/src/selfaudit.js` (`probeMode`, `selfAuditStep`) with the register `seed/autonomy/failure-modes.json` (per mode: failure, root cause, owner role, trigger, one read-only `SELECT` probe, remedy, optional fixes) and the tick step `selfaudit` in `seed/worker/src/tick.js`. Each run writes one row per mode to `failure_probe_runs` whether or not it is red; red files or reopens `FM-<id>` with closing probe `selfaudit:<id>`, green closes it with an outcome as evidence. Tests "every probe in the register is one SELECT that runs on the real schema", "a red probe files FM-<id>; green closes it with evidence; a closed item with a red probe is reopened" and "COSTGUARD-1: a red budget probe files the next fix, an over-budget sample stays red, a green sample closes fix and mode" in `seed/worker/test/selfaudit.test.js`. The kit's contract is the item (owner role, done check, closing probe); it has no `max_attempts`, backoff or deadline fields (those are in `core/kernel/failure.js`), and no `probation` state (R09 stays with 10.1).
- Loop breaker in the kit (R08 in part): BUILT in `seed/worker/src/selfaudit.js` (`loopBreak`), test "loop-breaker blocks an item dispatched 3 times with no outcome and files a LOOPBREAK item" in `seed/worker/test/selfaudit.test.js`. It blocks the item, releases its claim and files a root-cause item; it schedules no half-open probe (that is `core/kernel/failure.js`).
- Platform register and audit (R01, R03, R04 in part, R06, R16, R20, T09): BUILT in `foundation/failure_audit.py` with `doctrine/registers.json` (failure modes) and `doctrine/detectors.json` (per detector: failure mode, kind, command or reading, timeout, root cause, owner, remedy). Each run appends one line per detector to `ops/failure-audit.jsonl`, passes included; a failing detector files one `Q-AUDIT-<id>` item whose closing probe is the detector itself, with the changed files as suspects; a recovery closes the item with the passing evidence. A repeated signature changes the approach and a third marks an incident (in the module; no test is named for it). Tests `test_every_failure_mode_has_a_live_detector`, `test_failing_detector_files_one_queue_item_the_executor_can_take`, `test_recovery_closes_the_item_with_evidence_and_keeps_it`, `test_root_cause_names_what_changed_since_the_last_pass` and `test_missing_tool_is_a_finding_not_a_pass` in `tests/foundation/test_failure_audit.py`.
- Silent-drop reconcile at item level and guarded tick steps (R05 for items, T04 in the item form): BUILT in `seed/worker/src/tick.js` (step `reconcile`; a failing step files `TICKFAIL-`), tests "items that left the active set without a disposition are reopened and counted as silent drops" and "a failing step never kills the tick and becomes a backlog item" in `seed/worker/test/tick.test.js`.
- Stale metric as its own failure (R17; the kit's form of FM-FROZEN): BUILT in `seed/worker/src/tick.js` (step `measure`, item `STALE-<metric>`), tests "Q-LESSON-METRIC-FRESH: a reading older than twice the cadence files STALE-<id>; a fresh reading closes it" and "Q-LESSON-METRIC-FRESH: a probe that keeps failing keeps its old reading time and goes stale" in `seed/worker/test/metricfresh.test.js`.
- Loop proof (R18, R19, T08; the kit's form of FM-COVERAGE): BUILT in `seed/worker/src/pulse.js` (`beat`, `failed`, `judgeLoop`, `pulseStep`; tables `loop_beats` and `loop_clock`; item `MISSED-<loop>`), tests "beat leaves the proof: a good run, a thrown error and a returned error are all rows, and nothing throws", "IDLE-IS-NOT-OK-1: a loop that returns without doing its work is a failed beat, and one working route of several is a good one" and "pulse: every loop that runs every slot is ticking; a loop that stops is found, filed as MISSED-<loop>, and closed when it runs again" in `seed/worker/test/pulse.test.js`.
- A monitor that is not hosted in what it monitors (R10): BUILT in `seed/worker/src/pulse.js` (`watch`: a second producer on its own cron runs the tick when the newest one is older than two intervals, and leaves a beat that the tick in turn judges), called by the site Worker through its service binding (`site/worker.js`) and by the hosted watchdog workflow (`.github/workflows/watchdog.yml`); the Worker restarts that workflow when it stalls (`seed/worker/src/watchdog.js`). Tests "watchdog: a stale heartbeat is restarted by the second producer, and the tick it ran is in the ledger" in `seed/worker/test/pulse.test.js` and "a stalled GitHub watchdog is dispatched again (stall recovery)" in `seed/worker/test/watchdog.test.js`. That it is deployed on an account is not asserted here.
- Closure on production evidence only (R13): BUILT in `seed/worker/src/handoff.js` (an item closes after the live verify line passes, else the deploy is rolled back and the item reopened; tests in `seed/worker/test/handoff.test.js`, see US-SPEC-07).
- PLANNED in the running kit: retry bound, backoff and deadline on the kit's items, and escalation of an exhausted item through the gate or to another doer (R04 in full, R07), a half-open probe after the kit's loop breaker (R08 in full) and probation of a detector whose firings are not confirmed (R09), all in item `Q-SPEC-17-kit-remediation-contract`; visibility ratio across issue stores (R11) and the emitter-set roster (R12) outside `core/`; FM-SHADOW and FM-STALE-PREDICATE.
