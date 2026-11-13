-- CRITICALITY-1: external signals the Worker cannot read itself (GitHub runs, ops/cost.jsonl, human dispatches) land here as samples.
CREATE TABLE IF NOT EXISTS criticality_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  source TEXT NOT NULL,                   -- github-runs | cost-probe | owner | ...
  deploys_ok INTEGER NOT NULL DEFAULT 0,
  deploys_fail INTEGER NOT NULL DEFAULT 0,
  spend_units REAL NOT NULL DEFAULT 0,
  human_touches INTEGER NOT NULL DEFAULT 0,
  cap_breached INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS criticality_samples_at ON criticality_samples (at);
