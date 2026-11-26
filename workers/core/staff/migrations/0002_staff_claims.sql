-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-02-R06: an operation that ends an item removes its claim; the claim it removed is kept here so the reversal can restore it.
-- Additive and idempotent. Apply after 0001_staff.sql.

CREATE TABLE IF NOT EXISTS staff_action_claims (
  action_id INTEGER PRIMARY KEY,            -- the staff_actions row that removed the claim
  item_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT
);
