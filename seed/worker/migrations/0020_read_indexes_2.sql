-- FREE-TIER-1: the probe queries that scanned whole tables each tick (dispatches by model, items by status and update time, finished ticks).
-- Measured from D1 query analytics on ultrastable-org: 'dispatches WHERE model IN (...)' read ~690 rows per call for a count of 0.
CREATE INDEX IF NOT EXISTS dispatches_model ON dispatches(model);
CREATE INDEX IF NOT EXISTS items_status_updated ON items(status, updated_at);
CREATE INDEX IF NOT EXISTS tick_runs_finished ON tick_runs(finished_at);
