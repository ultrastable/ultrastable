-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-01 section 4.2 program_focus_log: the history of each program's focus set. kernel_focus holds only the current set; a row is appended here
-- only when a program's ranked set of item ids changes (core/kernel/programs.js setFocus), so growth follows change and not ticks.
CREATE TABLE IF NOT EXISTS kernel_focus_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_id INTEGER NOT NULL,
  program_id TEXT NOT NULL,
  items_json TEXT NOT NULL,                 -- JSON array of item ids, rank 1 first
  count INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kernel_focus_log ON kernel_focus_log(program_id, id);
