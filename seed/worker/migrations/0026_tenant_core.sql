-- Q-TENANT-row-isolation (TENANT-1): tenant_id on the core work-tracker rows, so a runtime acts only on its own tenant's rows.
-- Same convention as objectives and metrics (0004): NULL = this runtime's own tenant, a value = another tenant's row. Every existing row stays NULL (own), so
-- nothing changes for a single-tenant runtime. Additive only (ADD COLUMN, no table rebuild, no data movement); the migration ledger (_migrations) applies this file once.
-- READ-BUDGET: the tick scopes with `(tenant_id IS NULL OR tenant_id = ?)` on queries it already runs, evaluated on rows the status / primary-key path already reads,
-- so there is no new query and no scan; no index on tenant_id alone is added (it would only add write cost and is never the selective predicate).
-- trust_ledger keeps PRIMARY KEY (surface, action_class): widening it needs a table rebuild, which an additive migration does not do. The tick therefore never
-- overwrites a row that carries another tenant (see accrue_trust in src/tick.js).
ALTER TABLE items ADD COLUMN tenant_id TEXT;
ALTER TABLE claims ADD COLUMN tenant_id TEXT;
ALTER TABLE gate_cards ADD COLUMN tenant_id TEXT;
ALTER TABLE trust_ledger ADD COLUMN tenant_id TEXT;
