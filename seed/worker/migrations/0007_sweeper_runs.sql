-- SERVER-OWNS-LOOPS-1: every sweeper pass is a row, so "did the sweeper run live" is a query, never a log line.
CREATE TABLE IF NOT EXISTS sweeper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  status TEXT NOT NULL,                   -- ok | errors | no-token
  merged INTEGER NOT NULL DEFAULT 0,
  filed INTEGER NOT NULL DEFAULT 0,
  released INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  open_loop_age_hours REAL NOT NULL DEFAULT 0
);
