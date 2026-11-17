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

## 4. Schema

### 4.1 L1 core tables (BUILT)

| Table | Columns | Notes |
|---|---|---|
| `org` | key PK, value | Org settings (name, slug, owner reference). |
| `roles` | id PK, role, project, tick_every, model, last_tick_at | One row per role instance. |
| `items` | id PK, title, kind (`work`, `plus`, `fix`, `amendment`, `ladder`), project, owner_role, trigger_on, done_check, closing_probe, priority (0 highest), status (`open`, `ready`, `claimed`, `done`, `blocked`, `superseded`, `cancelled`), disposition, blocker, surface, action_class, created_at, updated_at | Index on `(status, priority)`. |
| `claims` | item_id PK references items, agent, claimed_at, heartbeat_at | |
| `gate_cards` | id PK, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe, status (`open`, `closed`), closed_at | Probe is `env:<NAME>`, `item_done:<id>` or `manual`. |
| `predictions` | id PK, item_id, metric, op (`>=`, `<=`, `>`, `<`, `=`), target, due_at, observed, verdict (`hit`, `miss`, null) | |
| `outcomes` | id PK, item_id, agent, surface, action_class, result (`verified`, `failed`, `hidden_failure`, `silent_drop`), evidence, at | Input to trust. |
| `trust_ledger` | surface, action_class, rung, reliability, outcomes, updated_at; PK (surface, action_class) | |
| `dispatches` | id PK, tick_id, role_id, item_id, model, status (`queued`, `running`, `done`, `failed`), at | |
| `tick_runs` | id PK, started_at, finished_at, steps_completed, steps_total, report, errors | One row per tick. |
| `doctrine_lineage` | version PK, source, adopted_at | Policy version history. |

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

## 6. Failure modes

| Failure | Effect | Detection or prevention |
|---|---|---|
| Nested view evaluated from several branches in one step | Store fails with out-of-memory (observed in QNFO) | Snapshot the view once per tick (US-03-R12) |
| Two stores each hold "open items" | Tools under-report open work (observed in QNFO: 303 open items in one store against 12 visible to operations tools) | One surface of record per record kind; reconciliation ratio (US-SPEC-17) |
| Destructive migration without export | Unrecoverable data loss | US-01-R04 |
| Secret value stored in a row | Disclosure | US-01-R06 |

## 7. Conformance tests

- **US-01-T01** Apply the L1 migration to an empty store, then apply it again. Pass: second run changes nothing. Fail: error or changed row counts.
- **US-01-T02** Insert two claims for one item. Pass: second insert is rejected. Fail: both accepted.
- **US-01-T03** Set an item `done` with empty disposition, run a tick. Pass: item reopened and a `silent_drop` outcome exists (US-SPEC-08). Fail: item stays done.
- **US-01-T04** Search all tables for a planted secret value after a dry-run bootstrap. Pass: no hit. Fail: any hit.

## 8. Reference implementation status


- L1 tables: BUILT. `core/migrations/0001_init.sql` creates all eleven tables in section 4.1 with the columns listed; `core/conformance/l1.test.js` checks the columns against section 4.1 and runs US-01-T01 (second application changes nothing), US-01-T02 (second claim rejected), US-01-T03 (silent drop reopened) and US-01-T04 (no planted secret value in any table). The migration uses `datetime('now')` defaults and `AUTOINCREMENT`, which are SQLite-dialect features (US-SPEC-14).
- Idempotent seed rows: BUILT in the bootstrapper (`bootstrap/bootstrap.py`, tested in `tests/test_seed.py`).
- Export-before-drop: BUILT as automation in `core/export/index.js` (tests: `core/export/export.test.js`). A migration is classified; one that drops or rewrites data is applied only after each affected table was exported to an object store, read back and matched by row count and hash, with the proof in the table `export_ledger`; a missing, unreadable or different export refuses the migration. The same test file checks that every migration shipped in the repository is additive.
- Export-before-drop against a hosted object store: PLANNED. The store is a port (`put`, `get`) that an R2 bucket binding fits; no live bucket has been used, and the migration tool that applies migrations to a deployed database does not yet call `core/export`.
- L2 records: RUNNING in QNFO under its own column names.
- L2 records in the seed: BUILT across the module migrations. `core/conformance/l2-records.json` maps 27 of the 29 records of section 4.2 to seed tables (for example `management_personas` to `staff_personas`, `decision_log` to `kernel_decisions` and `predict_decisions`, `work_claims` to `claims_lock`), and `core/conformance/l1.test.js` applies every module migration and fails if a mapped table is missing. A module's tables reach a deployed database when the module is listed in `core/org/modules.js`.
- L2 records `program_focus_log` and `model_task_matrix`: PLANNED. The seed keeps the current focus set with the tick that wrote it and no history of earlier sets; the model for each kind of task is router configuration, not a stored table.
- Disagreement with the source design: the QNFO design stores one `tick_runs` row per step (tick id, step, ok, evidence); the seed stores one row per tick with step counts. US-SPEC-03 permits either at L1 and requires per-step evidence at L2.
