-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Management lifecycle, monitoring and closing records (US-SPEC-15 R15, R16, R18, R19). Additive and idempotent.
-- Apply after 0001_lifecycle_gates.sql.

CREATE TABLE IF NOT EXISTS lifecycle_risk_reviews (         -- A-MON-4: the risk and issue register was reviewed
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  open_risks INTEGER NOT NULL,
  triggered TEXT NOT NULL,                  -- JSON array of the risk ids whose trigger probe fired
  flagged TEXT NOT NULL                     -- JSON array of { kind, id, why }: risks and issues missing an owner, response, trigger or probe
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_risk_reviews ON lifecycle_risk_reviews(project_id, reviewed_at);

CREATE TABLE IF NOT EXISTS lifecycle_quality (              -- A-MON-6: a value is null when nothing was measured, never 0
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  at TEXT NOT NULL,
  rework_rate REAL,
  defects_escaped INTEGER,
  probe_pass_rate REAL,
  inputs TEXT NOT NULL                      -- JSON: the counts the three values were computed from
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_quality ON lifecycle_quality(project_id, at);

CREATE TABLE IF NOT EXISTS lifecycle_variance (             -- A-MON-2 beyond the predictions: items late and capacity, one row per status report
  report_id INTEGER PRIMARY KEY,            -- lifecycle_status_reports.id
  items_late TEXT NOT NULL,                 -- JSON array of { id, age_days, sla_days }
  capacity_planned REAL,                    -- null = no capacity was planned for the project
  capacity_in_flight INTEGER NOT NULL,
  capacity_verdict TEXT NOT NULL            -- under | within | over | unmeasured
);

CREATE TABLE IF NOT EXISTS lifecycle_archive (              -- A-CLO-5: records retained, claims released, budgets closed
  project_id TEXT PRIMARY KEY,
  archived_at TEXT NOT NULL,
  archived_by TEXT NOT NULL,
  items_total INTEGER NOT NULL,
  items_done INTEGER NOT NULL,
  claims_released INTEGER NOT NULL,
  records TEXT NOT NULL                     -- JSON: the ids of what was retained, by kind
);
