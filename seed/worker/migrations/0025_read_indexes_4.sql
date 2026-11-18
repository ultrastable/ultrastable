-- READ-BUDGET-4 (2026-11-18): top queries by rows read on the org D1 (d1QueriesAdaptiveGroups, 3 h): DELETE FROM host_events WHERE at < ? read 214k rows in 233 runs
-- (no index on at); the public /ops readers scanned dispatches for status counts and the latest dispatch per role (181k, 178k, 200k rows).
CREATE INDEX IF NOT EXISTS host_events_at ON host_events(at);
CREATE INDEX IF NOT EXISTS dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS dispatches_role_id ON dispatches(role_id, id);
