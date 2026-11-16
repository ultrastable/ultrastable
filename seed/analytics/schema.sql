-- Ultrastable standard analytics schema (ANALYTICS-1). Additive only. Raw hits are pruned after 35 days by analytics.js selfcheck().
CREATE TABLE IF NOT EXISTS hits(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0, vid TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'pageview');
CREATE INDEX IF NOT EXISTS hits_at ON hits(at);
CREATE INDEX IF NOT EXISTS hits_name_at ON hits(name, at);
CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
