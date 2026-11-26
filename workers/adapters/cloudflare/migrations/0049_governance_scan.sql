-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-07-R23: the recognition scan over declared sources. One row per (source, ref) already scanned, so a draft is scanned once.
-- Additive and idempotent; the table name carries the module prefix.
CREATE TABLE IF NOT EXISTS governance_scan_cursor (
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  scan_id INTEGER,                          -- governance_scans.id of the scan
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (source, ref)
);
CREATE INDEX IF NOT EXISTS idx_governance_scan_cursor_at ON governance_scan_cursor(source, scanned_at);
