-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- DISPOSITION-1 (kernel 9.0.0 §3 F1, F2): one disposition per item and tick. `done` without a verifier is refused by the database itself.
-- Expand-only: a new table, nothing existing changes. foundation/disposition.py holds the same five kinds and the map from executor results.
CREATE TABLE IF NOT EXISTS disposition (
  item TEXT NOT NULL,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('done','flagged','blocked_by_gate','deferred_budget','failed')),
  evidence_uri TEXT NOT NULL,
  verifier TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (item, tick),
  CHECK (kind <> 'done' OR verifier IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS disposition_kind_resolved ON disposition (kind, resolved);
