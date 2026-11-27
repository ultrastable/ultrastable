-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Value-of-information outcomes and derivation attempts (US-SPEC-16 5.3, R01, R21, R23). Additive and idempotent. Tables are prefixed elicit_.
CREATE TABLE IF NOT EXISTS elicit_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  need_id TEXT NOT NULL,                     -- the catalog need; the same id across projects, which is how outcomes teach the next project
  estimate_p_wrong REAL NOT NULL,            -- the estimate the Ask was priced with
  rework REAL NOT NULL,
  dependents INTEGER NOT NULL,
  priority REAL NOT NULL,
  default_value TEXT,
  asked_at TEXT NOT NULL,
  settled_at TEXT,                           -- when the need left the asked state
  final_value TEXT,
  default_held INTEGER,                      -- 1 when the final value equals the default (a timeout counts as held), 0 when the person changed it
  UNIQUE (project, need_id)
);
CREATE INDEX IF NOT EXISTS idx_elicit_outcomes_need ON elicit_outcomes(need_id, settled_at);
CREATE TABLE IF NOT EXISTS elicit_derivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  need_id TEXT NOT NULL,
  surface TEXT NOT NULL,                     -- idea | record | probe | research
  result TEXT NOT NULL,                      -- hit | miss | no_source | error
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_elicit_derivations_need ON elicit_derivations(project, need_id);
CREATE TABLE IF NOT EXISTS elicit_need_feeds (
  project TEXT NOT NULL,
  need_id TEXT NOT NULL,
  artifact TEXT NOT NULL,                    -- the REQUIRED artifact (US-SPEC-15) the need feeds ...
  field TEXT NOT NULL,                       -- ... and the field of it (the catalog sweep matches on this, not on a label)
  PRIMARY KEY (project, need_id, artifact, field)
);
CREATE TABLE IF NOT EXISTS elicit_audit_runs (
  project TEXT NOT NULL,
  run_id TEXT NOT NULL,
  trigger TEXT NOT NULL,                     -- g1 | gate:<G> | surprise | schedule | manual
  independent INTEGER,                       -- 1 when the red-team sweep came from a model family other than the author's, 0 when it could not be verified
  at TEXT NOT NULL,
  PRIMARY KEY (project, run_id)
);
