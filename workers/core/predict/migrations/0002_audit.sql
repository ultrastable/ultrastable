-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-05-R18: the outside audit of the scorer. One row per verdict a party other than the system gave on a scored prediction.
-- Additive and idempotent; the table name carries the module prefix.
CREATE TABLE IF NOT EXISTS predict_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT NOT NULL,
  auditor TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('hit','miss','cannot-tell')),
  system_verdict TEXT NOT NULL CHECK (system_verdict IN ('hit','miss')),
  agrees INTEGER,                           -- 1 same verdict, 0 different, null when the auditor cannot tell
  evidence TEXT NOT NULL,
  audited_at TEXT NOT NULL,
  UNIQUE (prediction_id, auditor)
);
CREATE INDEX IF NOT EXISTS idx_predict_audits_auditor ON predict_audits(auditor, agrees);
