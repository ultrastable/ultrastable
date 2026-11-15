-- Q-CRIT-IGNITION: every chain link that does not close on itself, as a data row. The tick derives its own rows (open gate cards, unprobed
-- metrics, items whose owner role does not exist); collectors push the rest through /api/criticality/sample (`ignition_gaps`). A link that
-- closes is kept with status 'closed' and its time, never deleted. open_ignition_gaps sits next to k_eff in /live; self-sustaining only at 0.
CREATE TABLE IF NOT EXISTS ignition_gaps (
  link TEXT PRIMARY KEY,                  -- what does not close on itself, stable per link
  owner TEXT NOT NULL,                    -- role or loop that answers for it
  closing_probe TEXT NOT NULL,            -- what proves the link closed
  source TEXT NOT NULL,                   -- tick | external
  status TEXT NOT NULL DEFAULT 'open',    -- open | closed
  opened_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS ignition_gaps_status ON ignition_gaps (status);
