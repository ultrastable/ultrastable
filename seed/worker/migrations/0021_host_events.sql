-- HOSTS-1: every hosting action and every inbound hosting event, one row each, so deploy status and stalls are read from data.
CREATE TABLE IF NOT EXISTS host_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  host TEXT NOT NULL,
  kind TEXT NOT NULL,          -- deploy | deploy_failed | health | inbound | stall | failover
  worker TEXT,
  repo TEXT,
  sha TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS host_events_host_at ON host_events(host, at);
CREATE INDEX IF NOT EXISTS host_events_worker_sha ON host_events(worker, sha);
