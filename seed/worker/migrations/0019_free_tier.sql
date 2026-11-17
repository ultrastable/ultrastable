-- FREE-TIER-1 (2026-11-17): hourly account-wide usage samples against Cloudflare's free-plan daily allowances.
CREATE TABLE IF NOT EXISTS free_tier_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  resource TEXT NOT NULL,
  used_today REAL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS free_tier_samples_res ON free_tier_samples (resource, at);
