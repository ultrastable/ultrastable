-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Calibration runs for the weights of F (US-SPEC-13 R20). A run is a proposal: it is stored and filed through core/console-l3
-- (proposeObjectiveChange) and never written into the weights in effect. adopted_at is set the first time objective() sees
-- configuration carrying exactly these weights under sla.adopted_calibration.
CREATE TABLE IF NOT EXISTS sla_calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  rows_used INTEGER NOT NULL,                -- stored objective rows read
  weights TEXT NOT NULL,                     -- JSON: the proposed weights, one per term
  previous TEXT NOT NULL,                    -- JSON: the weights in effect when the run was made
  fit TEXT NOT NULL,                         -- JSON: n, r2, per-term coefficient and t, terms kept at their weight and why
  proposal_id INTEGER,                       -- l3_proposals.id
  adopted_at TEXT
);
