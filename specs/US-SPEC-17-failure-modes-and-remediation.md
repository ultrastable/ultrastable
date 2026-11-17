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

## 10. Reference implementation status

- In the seed: the silent-drop reconcile (item-level) and the guarded tick with `TICKFAIL` items are BUILT (`core/src/tick.js`, tests `core/test/tick.test.js`).
- Register and detectors (R01 to R03, R09): BUILT in `core/kernel/failure.js` with `core/kernel/migrations/0001_kernel.sql`; tests `core/kernel/failure.test.js` (T01, T02, T06 by id). Standard detectors (FM-UNACCOUNTED, FM-UNBOUNDED-RETRY, FM-FROZEN, FM-MASKED), registration on the second sighting of an undetected failure, and the status view: BUILT in `core/remediation/index.js` (`installStandard`, `reportFailure`, `statusView`) with `core/remediation/migrations/0001_remediation.sql`; tests `core/remediation/remediation.test.js`. FM-COVERAGE, FM-SHADOW and FM-STALE-PREDICATE are PLANNED: no module writes the probe log, deployer candidate list or alarm definitions they read. RUNNING in QNFO (about 634 failure modes with detectors, owner-reported 2026-11-10; the schema above is illustrative and the table of detectors lists audit examples that the audit procedure proposed as registrations, not rows read from the live table).
- Loop breaker as a signature rule (3 repeats in 24 hours, root-cause item, half-open probe; R08): BUILT in `core/kernel/failure.js` (`recordAttempt`, `canAttempt`; test `core/kernel/failure.test.js` T03). For a ledger whose writer has no breaker, such as the audited deployer: BUILT in `core/remediation/index.js` (`breakerFromLedger`, `retryAllowed`; test `core/remediation/remediation.test.js`). RUNNING in QNFO.
- Remediation contract with owner, doer, trigger, closing probe, retry bound (`max_attempts`, `backoff_h`) and deadline (`deadline_h`), the consumer that books one bucket per item, closure only on a passing probe, and escalation through the gate or reassignment (R04 to R07): BUILT in `core/kernel/failure.js`; tests `core/kernel/failure.test.js`. RUNNING in part in QNFO (owner, doer, trigger, probe).
- Silent-drop reconciliation across loops (the run ledgers of the kernel, claims and fleet modules; a loop that stops reporting; the item-set invariant with restore of a vanished item): BUILT in `core/remediation/index.js` (`reconcileLoops`, `reconcileItems`; test `core/remediation/remediation.test.js` T04). RUNNING in part in QNFO; the invariant did not hold in one component on 2026-09-13.
- Roster emitter-set detector (R12: `rosterReconcile`, `observedEmitters`), external liveness detector (R10: `externalLiveness`, which refuses to run inside the writer of the probe table) and closure of a repository fix on production evidence only (R13: `closeFix`): BUILT in `core/remediation/index.js`; tests `core/remediation/remediation.test.js`. Visibility ratio (R11): BUILT in `core/claims/gate.js`; tests `core/claims/gate.test.js`.
- Hosting the liveness detector in a second deployed worker (R10 in operation): PLANNED. It needs a live account; the check and its refusal to run in the writer are built.
- Not wired: `core/remediation/index.js` has a `step` surface that the composition root runs (`core/org/buildout.js` step `remediation`, test `core/org/org.test.js`). The second-worker liveness probe stays PLANNED.
