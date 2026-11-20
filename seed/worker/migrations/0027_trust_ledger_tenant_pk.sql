-- atomic: the statements below run as one transaction (D1 batch); see src/migrate.js. Do not run this file statement by statement.
-- Q-TENANT-trust-pk-rebuild (OL-20261118-4): the trust ledger's key now carries the tenant. 0026 added tenant_id additively, but PRIMARY KEY (surface, action_class)
-- stayed, so a row of another tenant at the same key blocked this runtime's own trust accrual (the upsert met the foreign row and wrote nothing).
-- The table is rebuilt with a unique key on (tenant, surface, action_class). tenant_id stays nullable (NULL = this runtime's own tenant, the 0004 and 0026 convention),
-- so the key is an expression index over COALESCE(tenant_id, ''): SQLite treats NULLs in a plain composite key as distinct, which would allow duplicate own rows.
-- Reversible: every row is first copied to trust_ledger_backup_0027 inside the same database (the ledger is tens of rows: one per surface and action class), and the
-- rebuild is all-or-nothing. Re-running the file on its own result is a no-op in effect (same rows, same key). Nothing else references the table (no view, trigger or
-- foreign key). READ-BUDGET: accrue_trust reads by (surface, action_class) with the tenant predicate, which this index serves as a prefix-free point lookup on rows it already reads.
CREATE TABLE IF NOT EXISTS trust_ledger_backup_0027 AS SELECT * FROM trust_ledger;
DROP TABLE IF EXISTS trust_ledger_v2;
CREATE TABLE trust_ledger_v2 (
  surface TEXT NOT NULL,
  action_class TEXT NOT NULL,
  rung TEXT NOT NULL,
  reliability REAL NOT NULL,
  outcomes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id TEXT
);
INSERT INTO trust_ledger_v2 (surface, action_class, rung, reliability, outcomes, updated_at, tenant_id) SELECT surface, action_class, rung, reliability, outcomes, updated_at, tenant_id FROM trust_ledger;
DROP TABLE trust_ledger;
ALTER TABLE trust_ledger_v2 RENAME TO trust_ledger;
CREATE UNIQUE INDEX IF NOT EXISTS trust_ledger_tenant_key ON trust_ledger (COALESCE(tenant_id, ''), surface, action_class);
