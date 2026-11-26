<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-01: Data model

| Field | Value |
|---|---|
| ID | US-SPEC-01 |
| Title | Data model |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Ultrastable keeps all organizational state in shared records: work, decisions, predictions, outcomes, claims, trust and tick evidence. Agents communicate through these records, so the schema is the contract between roles. This specification defines the L1 core schema that the seed implements and the L2 and L3 records that a managed or fleet installation adds.

## 2. Terms

| Term | Definition |
|---|---|
| Store | A relational handle exposing `prepare(sql).bind(...).all() / .first() / .run()`, with `meta.changes` and `meta.last_row_id` on `run()` (US-SPEC-14). |
| Active set | Items whose status is not `done`, `superseded` or `cancelled`. |
| View | A stored query that computes a ranking or plan on read. |
| Invariant trigger | A store trigger that enforces an invariant on write. |
| Own row | A row whose `tenant_id` is null or equals the runtime's own slug. |
| Staging table | A table a migration creates and renames away in the same file while rebuilding another table. |

## 3. Normative requirements

- **US-01-R01 [L1]** An implementation MUST persist the L1 tables of section 4 with at least the listed columns.
- **US-01-R02 [L1]** The `claims` table MUST allow at most one live claim per item (primary key on `item_id`, or equivalent).
- **US-01-R03 [L1]** An item in `done`, `superseded` or `cancelled` MUST carry a non-empty `disposition`.
- **US-01-R04 [L1]** Schema migrations MUST be additive. A migration that drops or rewrites data MUST be preceded by an export of the affected table to an object store, with the export verified readable.
- **US-01-R05 [L1]** Seed rows MUST be inserted idempotently (`INSERT OR IGNORE` or equivalent) so that running a seed twice changes nothing.
- **US-01-R06 [L1]** The store MUST never hold secret values. Connector configuration MUST refer to secrets by name only.
- **US-01-R07 [L2]** Rows written to a table shared by several roles MUST carry the writer's identifier, and a role MUST delete only rows it wrote.
- **US-01-R08 [L2]** An implementation SHOULD compute rankings (risk, queue order, focus candidates) in views, so a reader sees the same ordering the managers used.
- **US-01-R09 [L2]** Each registered metric MUST have a trigger row that files a work item on breach, or a named exemption.
- **US-01-R10 [L2]** An implementation MUST record each decision in a decision log with its predicted outcome and revert path (US-SPEC-05).
- **US-01-R11 [L1]** Timestamps MUST follow US-00-R05.
- **US-01-R12 [L1]** Where several tenants share a store, rows of `items`, `claims`, `gate_cards`, `trust_ledger`, `objectives` and `metrics` MUST carry a tenant identifier (null meaning the runtime's own tenant). A runtime MUST read, claim, advance, close and count only its own rows, and the key of `trust_ledger` MUST include the tenant.
- **US-01-R13 [L1]** A migration runner MUST refuse, before any statement runs, a migration file that drops a table or a column unless the file applies as one transaction and an earlier statement of the same file copied the whole table. A staging table needs no copy. The refusal MUST be filed as a work item.
- **US-01-R14 [L1]** Applied migrations MUST be recorded with a hash of the file. An applied file whose text later changes MUST be reported as drift and MUST NOT be re-run.
- **US-01-R15 [L2]** An implementation SHOULD copy the store to an object store on a schedule, read the copy back and compare row counts before the copy counts as a backup, and MUST leave tables that hold sealed credentials out of the copy.

## 4. Schema

### 4.1 L1 core tables (BUILT)

| Table | Columns | Notes |
|---|---|---|
| `org` | key PK, value | Org settings (name, slug, owner reference). |
| `roles` | id PK, role, project, tick_every, model, last_tick_at | One row per role instance. |
| `items` | id PK, title, kind (`work`, `plus`, `fix`, `amendment`, `ladder`), project, owner_role, trigger_on, done_check, closing_probe, priority (0 highest), status (`open`, `ready`, `claimed`, `done`, `blocked`, `superseded`, `cancelled`), disposition, blocker, surface, action_class, created_at, updated_at | Index on `(status, priority)`. In the seed also `tenant_id`, and an index on `(status, updated_at)`. A lower number sorts first, and the seed files a failing migration below 0. |
| `claims` | item_id PK references items, agent, claimed_at, heartbeat_at | In the seed also `tenant_id`. |
| `gate_cards` | id PK, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe, status (`open`, `closed`), closed_at | Probe is `env:<NAME>`, `item_done:<id>` or `manual`; the seed adds `owner_items:<n>` and `connector:<provider>` (US-SPEC-03). In the seed also `tenant_id`. |
| `predictions` | id PK, item_id, metric, op (`>=`, `<=`, `>`, `<`, `=`), target, due_at, observed, verdict (`hit`, `miss`, null) | |
| `outcomes` | id PK, item_id, agent, surface, action_class, result (`verified`, `failed`, `hidden_failure`, `silent_drop`), evidence, at | Input to trust. The seed's doer also records `parked`, `superseded` and `released`, which count toward the number of outcomes and not toward successes or severe failures. |
| `trust_ledger` | surface, action_class, rung, reliability, outcomes, updated_at; PK (surface, action_class) | In the seed the key is unique on (tenant, surface, action_class), with a null tenant read as the runtime's own (US-01-R12). |
| `dispatches` | id PK, tick_id, role_id, item_id, model, status (`queued`, `running`, `done`, `failed`), at | In the seed the doer sets the status to the state it settled (`done`, `parked`, `superseded`), the reaper sets `released`, and `model` holds what answered, or `rules (no model)`, never a configured tier label. |
| `tick_runs` | id PK, started_at, finished_at, steps_completed, steps_total, report, errors | One row per tick. |
| `doctrine_lineage` | version PK, source, adopted_at | Policy version history. |

### 4.1.1 Seed additions to the core (BUILT)

The seed's later migrations add these records beside the eleven tables. Each is additive except the rebuild of `trust_ledger`, which copies the table first (US-01-R13).

| Table | Columns | Notes |
|---|---|---|
| `objectives` | id PK, tenant_id, statement, owner_role, created_at | One per first outcome of the idea. |
| `metrics` | id PK, tenant_id, objective_id, name, kind (`liveness`, `target`, `guard`), source (`builtin`, `sql`, `http`, `service`, `declared`), spec, op, threshold, grace_hours, owner_role, remedy, last_value, last_at, breached, created_at | The metric registry and its trigger in one row: the measure step files the remedy on breach (US-01-R09, US-SPEC-05 section 3.5). |
| `decision_log` | id PK, at, point, chosen, metric, op, target, predicted, basis, measured, hit, settled_at | Decisions of the Worker's own decision points with the predicted and the measured effect (US-01-R10). |
| `_migrations` | file PK, sha256, at | The migration ledger (US-01-R14). |
| `loop_beats`, `loop_clock` | one row per loop run; one row per loop with its measured state | Evidence that each loop beside the tick ran (US-SPEC-11). |
| `criticality_samples`, `criticality_history`, `criticality_actions`, `ignition_gaps`, `ignition_log` | | US-SPEC-23. |
| `failure_probe_runs` | | US-SPEC-17. |
| `audit_log`, `audit_segments` | | Hash-chained record of deploys, handoff steps and decisions; aged rows are chained before retention deletes them. |

### 4.2 L2 records (RUNNING in QNFO)

Column names are illustrative; the roles of the tables are normative.

| Record | Purpose |
|---|---|
| `management_personas`, `program_charters` | Roles with decision authority; programs with primary and guard metrics (US-SPEC-02). |
| `program_risk_now`, `portfolio_allocations`, `program_focus`, `program_focus_log` | The managerial tick snapshot and slot allocation (US-SPEC-03). |
| `issue_priority_scores`, `queue_pulls` | Queue scoring and pull record. |
| `persona_actions`, `persona_briefs` | What each manager did, with from and to values, and its plain-language brief. |
| `decision_log`, `decision_predictions`, `decision_outcomes` | Decisions, parsed predictions, scored outcomes (US-SPEC-05). |
| `trust_transitions` | Ladder changes with evidence (US-SPEC-06). |
| `product_registry`, `plus_ledger` | Products and pluses (US-SPEC-04). |
| `work_claims` | Path-level claims with token and fence (US-SPEC-08). |
| `human_actions` | Principal queue (US-SPEC-06, US-SPEC-08). |
| `failure_modes`, `failure_mode_hits` | US-SPEC-17. |
| `false_stop_register`, `false_stop_phrases`, `false_stop_hits`, `doctrine_proposals` | US-SPEC-07. |
| `ops_config` | Key-value switches that stop an operation without a deploy (US-SPEC-09). |
| `metric_registry`, `metric_triggers` | Metrics and the triggers that file items on breach. |
| `model_task_matrix`, `model_admission` | US-SPEC-09. |

## 5. Behavior

- Time comparison: all `*_at` and `due_at` columns compare as strings.
- Views compute rankings on read; triggers enforce invariants (a registered metric has a trigger; a parked task is rerouted rather than queued for the principal; a prediction written in the parsable form is copied into the prediction table).
- The tick of US-SPEC-03 is the principal writer of `tick_runs`, `claims`, `dispatches`, `trust_ledger` and `gate_cards` status.
- Tenant rows: a runtime applies one predicate, `tenant_id IS NULL OR tenant_id = <its slug>`, to every read, claim, close and count over the tables of US-01-R12, and every row it writes carries no tenant. The predicate is evaluated on rows the existing access path already reads.
- Migrations in the seed are applied by the tick itself through its store handle, so no credential is needed. A file runs once and is recorded with its hash; a file whose first line starts with `-- atomic:` applies as one transaction. A statement that adds a column already present is skipped. The count of failed and drifted files is written to `org` under `migrations_pending`.
- Copy before drop in the seed: a file that drops a table or column is refused unless it is atomic and an earlier statement is `CREATE TABLE <copy> AS SELECT * FROM <table>`. The copy lives in the same store; the daily snapshot of the whole store to an object store is its second home. Row rewrites (`UPDATE`, `DELETE`) are not judged by this rule.

## 6. Failure modes

| Failure | Effect | Detection or prevention |
|---|---|---|
| Nested view evaluated from several branches in one step | Store fails with out-of-memory (observed in QNFO) | Snapshot the view once per tick (US-03-R12) |
| Two stores each hold "open items" | Tools under-report open work (observed in QNFO: 303 open items in one store against 12 visible to operations tools) | One surface of record per record kind; reconciliation ratio (US-SPEC-17) |
| Destructive migration without export | Unrecoverable data loss | US-01-R04 |
| Secret value stored in a row | Disclosure | US-01-R06 |
| A row of another tenant sits at the same trust key | The runtime's own trust never accrues (observed in the seed before its key carried the tenant) | US-01-R12 |
| A table rebuild fails between the drop and the rename | No table | One transaction per rebuild file (US-01-R13) |
| An applied migration is edited | Stores diverge silently | Hash ledger and drift item (US-01-R14) |

## 7. Conformance tests

- **US-01-T01** Apply the L1 migration to an empty store, then apply it again. Pass: second run changes nothing. Fail: error or changed row counts.
- **US-01-T02** Insert two claims for one item. Pass: second insert is rejected. Fail: both accepted.
- **US-01-T03** Set an item `done` with empty disposition, run a tick. Pass: item reopened and a `silent_drop` outcome exists (US-SPEC-08). Fail: item stays done.
- **US-01-T04** Search all tables for a planted secret value after a dry-run bootstrap. Pass: no hit. Fail: any hit.
- **US-01-T05** Give the migration runner a file that creates a table and then drops `items` with no copy. Pass: the file is refused, neither statement ran, the rows of `items` remain and a work item names the file. Fail: any statement ran.
- **US-01-T06** Insert a ready item, a stale claim and an open gate card that carry another tenant's identifier and run a tick. Pass: none of them is dispatched, released, closed or counted. Fail: any is touched.
- **US-01-T07** Edit the text of an applied migration and run the runner. Pass: the file is not re-run, drift is reported and one work item exists.

## 8. Reference implementation status

Paths that start with `core/` are in the `workers/` directory; paths that start with `seed/` are from the repository root.

- L1 tables: BUILT. `core/migrations/0001_init.sql` and `seed/worker/migrations/0001_init.sql` each create all eleven tables in section 4.1 with the columns listed; `core/conformance/l1.test.js` checks the columns against section 4.1 and runs US-01-T01 (second application changes nothing), US-01-T02 (second claim rejected), US-01-T03 (silent drop reopened) and US-01-T04 (no planted secret value in any table). The migrations use `datetime('now')` defaults and `AUTOINCREMENT`, which are SQLite-dialect features (US-SPEC-14).
- Seed additions to the core (section 4.1.1): BUILT in `seed/worker/migrations/` (listed in `seed/worker/migrations/index.json`, which `seed/worker/test/migrate.test.js` keeps equal to the directory). `seed/worker/src/ignition.js` (`REQUIRED_TABLES`) names the tables a seeded system must hold before it reads itself as seeded.
- Tenant rows (US-01-R12, US-01-T06): BUILT in `seed/worker/src/tenant.js` (`OWN_SQL`, `tenantOf`) with `seed/worker/migrations/0026_tenant_core.sql` and `seed/worker/migrations/0027_trust_ledger_tenant_pk.sql`, tests in `seed/worker/test/tenant-isolation.test.js` (reconcile, reap, gates, dispatch, execute, trust and the counts each ignore another tenant's rows).
- Migration ledger and drift (US-01-R14, US-01-T07): BUILT in `seed/worker/src/migrate.js` (`migrateStep`), tests "a recorded migration is skipped, an unrecorded one is applied once and ledgered with the file sha256" and "an applied file whose text changed is drift: not re-run, pending 1, an item is filed" in `seed/worker/test/migrate.test.js`.
- Copy before drop in the seed's migration runner (US-01-R13, US-01-T05): BUILT in `seed/worker/src/migrate.js` (`unbackedDrops`, called by `migrateStep` before any statement of a file runs), tests "US-01-R04: every shipped migration is additive, or copies the whole table in the same atomic file before it drops it" and "US-01-R04: the tick refuses a migration that drops a table with no copy: nothing runs, the table and its rows stay, an item is filed" in `seed/worker/test/migrate.test.js`. One shipped file drops a table (`seed/worker/migrations/0027_trust_ledger_tenant_pk.sql`) and passes because it copies the ledger first inside one transaction; its rebuild is tested in `seed/worker/test/tenant-isolation.test.js`. Limits: the copy is a table in the same store, not an object-store export; a row rewrite is not judged (`seed/worker/migrations/0014_model_truth.sql` rewrites labels in `dispatches` with no copy).
- Idempotent seed rows: BUILT in the bootstrapper (`bootstrap/bootstrap.py`, tested in `tests/test_seed.py`); the seed tick seeds its liveness metrics with `INSERT OR IGNORE` (`seed/worker/src/tick.js`, test "LIVENESS-SEED-1" in `seed/worker/test/measure.test.js`).
- Export-before-drop to an object store (US-01-R04): BUILT as automation in `core/export/index.js` (tests: `core/export/export.test.js`). A migration is classified; one that drops or rewrites data is applied only after each affected table was exported to an object store, read back and matched by row count and hash, with the proof in the table `export_ledger`; a missing, unreadable or different export refuses the migration. The same test file checks that every migration shipped in `workers/` is additive.
- Scheduled copy of the store to an object store (US-01-R15): BUILT in `seed/worker/src/d1snapshot.js` (`snapshotD1`: once a day, gzip NDJSON, read back and row-counted before it counts, credential tables excluded, the newest copies kept), tests in `seed/worker/test/d1snapshot.test.js`. With no bucket bound the step reports a skip and never a pass.
- Export-before-drop against a hosted object store, as a gate on the migration: PLANNED. The store of `core/export` is a port (`put`, `get`) that an R2 bucket binding fits; neither `core/migrations/selfmigrate.js` nor `seed/worker/src/migrate.js` calls it, so a drop is gated by the in-store copy in the seed and by the additive check in `workers/`. Work item `Q-SPEC-01-R04-object-store-gate`.
- Writer identifiers on shared tables (US-01-R07): BUILT in `core/staff/index.js` (rows of queue scores and persona actions carry their writer), tests in `core/staff/staff.test.js`. The seed's core tables carry `agent` on `claims` and `outcomes` and no writer column elsewhere.
- Metric registry with a breach trigger (US-01-R09): BUILT in the seed as the `metrics` table and the measure step (`seed/worker/src/tick.js`, tests in `seed/worker/test/measure.test.js`); in `workers/` as `kernel_metrics` (`core/kernel/metrics.js`, `core/kernel/metrics-decisions.test.js`).
- Decision log (US-01-R10): BUILT in `core/predict/index.js` and `core/kernel/decisions.js` (US-SPEC-05). The seed's `decision_log` (`seed/worker/src/decisions.js`, tests in `seed/worker/test/decisions.test.js`) records the predicted and measured effect of each registered decision point; it carries no revert path column.
- L2 records: RUNNING in QNFO under its own column names.
- L2 records in the seed: BUILT across the module migrations. `core/conformance/l2-records.json` maps 28 of the 29 records of section 4.2 to seed tables (for example `management_personas` to `staff_personas`, `decision_log` to `kernel_decisions` and `predict_decisions`, `work_claims` to `claims_lock`, `model_task_matrix` to `ladder_model_task_matrix`), and `core/conformance/l1.test.js` applies every module migration and fails if a mapped table is missing. A module's tables reach a deployed database when the module is listed in `core/org/modules.js`.
- L2 record `model_task_matrix`: BUILT in `core/ladder/migrations/0001_ladder.sql` (`ladder_model_task_matrix`, beside `ladder_model_admission`), tests in `core/ladder/ladder.test.js`.
- L2 record `program_focus_log`: PLANNED. The seed keeps the current focus set with the tick that wrote it (`kernel_focus`) and no history of earlier sets. Work item `Q-SPEC-01-focus-log`.
- Disagreement with the source design: the QNFO design stores one `tick_runs` row per step (tick id, step, ok, evidence); both ticks here store one row per tick with step counts. US-SPEC-03 permits either at L1 and requires per-step evidence at L2.
