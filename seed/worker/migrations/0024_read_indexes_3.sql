-- READ-BUDGET-2 (2026-11-18): the org D1 read 250,971 rows in an hour against a 120,000 limit and the tick sat in degrade (skipped selfaudit, dispatch, execute).
-- The essential `measure` step runs four metrics that filter loop_beats by started_at alone, but the only index is (loop, slot), so each scanned all 3,242 rows
-- every tick; the finished_at filter on tick_runs scanned every tick row too. These indexes turn those scans into range reads.
CREATE INDEX IF NOT EXISTS loop_beats_started ON loop_beats(started_at);
CREATE INDEX IF NOT EXISTS tick_runs_finished ON tick_runs(finished_at);
