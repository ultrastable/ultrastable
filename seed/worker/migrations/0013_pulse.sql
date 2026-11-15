-- LOOPPROOF-1: the proof that every loop ran every time. loop_beats is one row per loop per run, written BEFORE the loop body runs and
-- completed after it, so a loop that never returned is a row with ok NULL, not an absence. loop_clock is the judged state of every loop
-- (expected, ran, good and missed slots over 24 h). ignition_log is the append-only record of every stage the system reached or lost on its
-- way from bootstrap to criticality (BOOT-KNOWS-1). The same statements are in src/pulse.js (PULSE_DDL), applied by the Worker itself, so
-- code that arrives before this migration still has its tables (SCHEMA-SELF-1); test/pulse.test.js holds the two copies equal.
CREATE TABLE IF NOT EXISTS loop_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, loop TEXT NOT NULL, slot INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'cron', started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, error TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS loop_beats_loop ON loop_beats (loop, slot);
CREATE TABLE IF NOT EXISTS loop_clock (loop TEXT PRIMARY KEY, every_min INTEGER NOT NULL, declared INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, why TEXT, last_run TEXT, last_good TEXT, expected_24h INTEGER NOT NULL DEFAULT 0, ran_24h INTEGER NOT NULL DEFAULT 0, good_24h INTEGER NOT NULL DEFAULT 0, missed_24h INTEGER NOT NULL DEFAULT 0, coverage REAL, bad_streak INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ignition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, stage TEXT NOT NULL, prev TEXT, direction TEXT NOT NULL, evidence TEXT NOT NULL);
