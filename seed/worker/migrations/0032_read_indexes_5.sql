-- READ-BUDGET-9 (2026-11-26): the org D1 read 400k to 1M rows an hour (10M at the peak of 2026-11-25) against a budget of 120k, so every tick ran lean
-- and no role was dispatched. Top readers by rows read (d1QueriesAdaptiveGroups, 3 h and 6.5 h) that an index answers:
--   live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT ?            705 rows a call, 151 calls an hour: the only indexes were (repo, n) and (merged_at)
--   live_changes WHERE substance IS NULL ORDER BY merged_at DESC LIMIT ?   589 rows a call: with nothing pending it walked every row
--   credential_events WHERE tenant = ? AND provider = ? ORDER BY id DESC   3,140 to 4,438 rows a call (connector_health, once per connector per tick)
--   credential_events WHERE tenant = ? AND provider = ? AND event = ?      451 to 4,318 rows a call (archive, rulesets, app-audit): the only index was (at)
-- The two substance columns are added by the Worker itself (livechanges.js ensureSubstance) and were in no migration; they are declared here so the
-- partial index applies on a fresh database too (an existing column is skipped by both migration runners).
ALTER TABLE live_changes ADD COLUMN substance TEXT;
ALTER TABLE live_changes ADD COLUMN substance_files INTEGER;
CREATE INDEX IF NOT EXISTS live_changes_repo_merged ON live_changes(repo, merged_at);
CREATE INDEX IF NOT EXISTS live_changes_pending ON live_changes(merged_at) WHERE substance IS NULL;
CREATE INDEX IF NOT EXISTS credential_events_tenant_provider ON credential_events(tenant, provider, id);
CREATE INDEX IF NOT EXISTS credential_events_tenant_event ON credential_events(tenant, event, provider, at);
