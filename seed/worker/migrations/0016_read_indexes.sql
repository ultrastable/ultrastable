-- READ-BUDGET-1 (2026-11-16): indexes for the queries the tick and dashboard run most often. Measured on the org D1 that day:
-- MIN(started_at) FROM tick_runs read every row 135 times a day, and the dispatches/outcomes lookups by item and time scanned whole tables.
-- On the Cloudflare free plan (5 million rows read a day) these scans alone used a quarter of the allowance.
CREATE INDEX IF NOT EXISTS hits_name_at ON hits(name, at);
CREATE INDEX IF NOT EXISTS tick_runs_started ON tick_runs(started_at);
CREATE INDEX IF NOT EXISTS dispatches_item ON dispatches(item_id, at);
CREATE INDEX IF NOT EXISTS dispatches_at ON dispatches(at);
CREATE INDEX IF NOT EXISTS outcomes_item ON outcomes(item_id, result);
CREATE INDEX IF NOT EXISTS outcomes_result_at ON outcomes(result, at);
