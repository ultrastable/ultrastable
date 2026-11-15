-- PULSE-1: the evidence the system reads to know it is bootstrapped and that every loop ran in every slot (worker/src/pulse.js).
-- The Worker creates these itself on first use (pulse.js DDL, same statements), so a deploy route that applies no migration still works.
CREATE TABLE IF NOT EXISTS loop_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, loop TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, ms INTEGER, evidence TEXT);
CREATE INDEX IF NOT EXISTS loop_beats_loop ON loop_beats (loop, started_at);
CREATE TABLE IF NOT EXISTS tick_steps (tick_id INTEGER NOT NULL, step TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER NOT NULL, error TEXT, PRIMARY KEY (tick_id, step));
CREATE TABLE IF NOT EXISTS ignition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tick_id INTEGER, from_stage TEXT, to_stage TEXT NOT NULL, direction TEXT NOT NULL, evidence TEXT);
