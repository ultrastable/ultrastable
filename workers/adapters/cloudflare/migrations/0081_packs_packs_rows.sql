-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Rows a pack created in the shared tables (US-21-R08). The sandbox records an INSERT into items or predictions that created a row, and lets a
-- pack UPDATE a prediction only when this ledger says the pack created it, so a pack whose id is a prefix of another id family cannot change
-- that family's rows. A pack can never read this table. Idempotent.
CREATE TABLE IF NOT EXISTS packs_rows (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tbl, row_id)
);
CREATE INDEX IF NOT EXISTS idx_packs_rows_pack ON packs_rows(pack_id);
