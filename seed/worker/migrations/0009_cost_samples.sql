-- COSTGUARD-1: hourly rows-read samples per budgeted external D1 database, taken server-side by the tick Worker (GraphQL d1AnalyticsAdaptiveGroups).
CREATE TABLE IF NOT EXISTS cost_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  target TEXT NOT NULL,          -- budget id
  rows_read_1h INTEGER,          -- NULL when the sample failed
  error TEXT
);
CREATE INDEX IF NOT EXISTS cost_samples_target ON cost_samples (target, at);
