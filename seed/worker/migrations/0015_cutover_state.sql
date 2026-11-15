-- ACCOUNT-SPLIT-2: the controller's per-account state (slot, epoch, peer misses, github_ok). Mirrors DDL in src/cutover.js, which creates it on first use too.
CREATE TABLE IF NOT EXISTS cutover_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
