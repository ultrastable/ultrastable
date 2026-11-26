-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Automatic staggering (US-11-R12): every schedule rewrite the stagger pass made, with the collisions it removed. Idempotent.
CREATE TABLE IF NOT EXISTS fleet_stagger_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  name TEXT NOT NULL,
  old_expr TEXT NOT NULL,
  new_expr TEXT NOT NULL,
  collisions_before INTEGER NOT NULL,
  collisions_after INTEGER NOT NULL
);
