-- LIVE-FRESH-1: merged pull requests cached by the tick every pass, so the public changelog on /live never waits for a daily snapshot.
CREATE TABLE IF NOT EXISTS live_changes (
  n INTEGER NOT NULL,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  by_origin TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (repo, n)
);
CREATE INDEX IF NOT EXISTS live_changes_merged ON live_changes(merged_at);
CREATE TABLE IF NOT EXISTS live_changes_meta (repo TEXT PRIMARY KEY, refreshed_at TEXT NOT NULL);
