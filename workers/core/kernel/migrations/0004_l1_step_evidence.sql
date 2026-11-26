-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-03-R11: one evidence row per L1 tick step (the eight steps of core/src/tick.js), written by runL2 from what the tick recorded for each step.
-- A separate table so kernel_step_evidence keeps exactly the L2 sub-steps; kernel_v_step_evidence reads both layers together.
CREATE TABLE IF NOT EXISTS kernel_l1_step_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_id INTEGER NOT NULL,
  step TEXT NOT NULL,
  ok INTEGER NOT NULL,
  evidence TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kernel_l1_evidence ON kernel_l1_step_evidence(tick_id);

CREATE VIEW IF NOT EXISTS kernel_v_step_evidence AS
  SELECT tick_id, step, ok, evidence, at, 'l1' AS layer FROM kernel_l1_step_evidence
  UNION ALL
  SELECT tick_id, step, ok, evidence, at, 'l2' AS layer FROM kernel_step_evidence;
