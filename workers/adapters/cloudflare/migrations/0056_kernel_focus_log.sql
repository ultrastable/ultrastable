-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- program_focus_log (US-SPEC-01 s4.2): the history of each program's focus set. A row is written only when the set changes,
-- so a steady program adds nothing per tick and the table stays small.

CREATE TABLE IF NOT EXISTS kernel_focus_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL,
  tick_id INTEGER NOT NULL,
  items TEXT NOT NULL,                      -- JSON array of item ids in rank order
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kernel_focus_log_prog ON kernel_focus_log(program_id, id);
