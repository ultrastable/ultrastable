-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Stagger skips (US-11-R12, US-11-R08): a move of a schedule that already fired in its period keeps it from firing twice, so the slots of
-- the new expression from the move up to the first firing it set stay without a record on purpose. One row per such move of a declared
-- procedure; the dead-man check does not judge those slots. A new table, not a column, so applying every migration twice stays idempotent.
CREATE TABLE IF NOT EXISTS fleet_stagger_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,                   -- the fleet_stagger_log row of the move
  procedure TEXT NOT NULL,
  expr TEXT NOT NULL,                        -- the expression the move set
  moved_at TEXT NOT NULL,                    -- slots that end after this ...
  first_fire TEXT NOT NULL                   -- ... and start before the first firing the move set are not judged
);
CREATE INDEX IF NOT EXISTS idx_fleet_stagger_skips ON fleet_stagger_skips(procedure, expr);
