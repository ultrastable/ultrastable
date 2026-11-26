-- READ-BUDGET-10 (2026-11-26): the org D1 read 175k rows an hour against a budget of 120k, so every tick ran lean (dispatch and execute deferred)
-- and open issues sat for hours. Top readers by rows read in the last hour (d1QueriesAdaptiveGroups, ultrastable-org) that an index answers:
--   kg_nodes WHERE changed_at > ? AND valid_to IS NULL ORDER BY changed_at LIMIT ?   115,371 rows in 27 calls (graphai.js): no index on changed_at
--   outcomes WHERE result = ? AND at >= ? AND at < ? AND action_class IN (...)        100k rows in 112 calls (trust ledger): the only index was (item_id)
--   dispatches WHERE status = 'released' AND at >= ?                                  13,124 rows in 34 calls: a full scan each call
CREATE INDEX IF NOT EXISTS kg_nodes_changed_live ON kg_nodes(changed_at) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS outcomes_result_at ON outcomes(result, at, action_class);
CREATE INDEX IF NOT EXISTS dispatches_status_at ON dispatches(status, at);
