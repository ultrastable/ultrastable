-- SPINOFF-1: events for spun-off apps; aggregate-only by design (no IP, name, address or readable domain).
CREATE TABLE IF NOT EXISTS spinoff_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, app TEXT NOT NULL, visitor TEXT NOT NULL, dhash TEXT NOT NULL DEFAULT '', failed TEXT NOT NULL DEFAULT '', nfail INTEGER NOT NULL DEFAULT 0, prev_nfail INTEGER NOT NULL DEFAULT 0, fixes INTEGER NOT NULL DEFAULT 0, recheck INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL DEFAULT '', blocked INTEGER NOT NULL DEFAULT 0, error INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS spinoff_app_at ON spinoff_events (app, at);
CREATE INDEX IF NOT EXISTS spinoff_app_dhash ON spinoff_events (app, dhash);
-- USE-COUNT-1 (BENEFIT-1): aggregate daily use per live public-benefit app; a count only, no visitor data. Also created lazily by spinoffs/live.js.
CREATE TABLE IF NOT EXISTS spinoff_daily (app TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (app, day));
