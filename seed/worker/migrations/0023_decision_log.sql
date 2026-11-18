-- DECISIONS-1: Worker-side decision points (AI router, free-tier governor) log the metric, predicted effect and measured outcome of each decision.
CREATE TABLE IF NOT EXISTS decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, point TEXT NOT NULL, chosen TEXT NOT NULL, metric TEXT NOT NULL, op TEXT NOT NULL, target REAL NOT NULL, predicted REAL, basis TEXT, measured REAL, hit INTEGER, settled_at INTEGER);
CREATE INDEX IF NOT EXISTS decision_log_point_at ON decision_log (point, at);
