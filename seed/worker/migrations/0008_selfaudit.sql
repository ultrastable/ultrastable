-- SELFAUDIT-1: every probe run of the failure-mode register, so a red probe has a history and a green one has evidence.
CREATE TABLE IF NOT EXISTS failure_probe_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  healthy INTEGER,            -- 1 green, 0 red, NULL when the probe itself errored
  error TEXT
);
CREATE INDEX IF NOT EXISTS failure_probe_runs_mode ON failure_probe_runs (mode_id, at);
