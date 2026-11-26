-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Email pack, newsletter composition from the claims registry (US-SPEC-21 s7, US-SPEC-22). Idempotent.
CREATE TABLE IF NOT EXISTS email_compose_log (
  message_id INTEGER NOT NULL,
  claim_id TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (message_id, claim_id)
);
CREATE INDEX IF NOT EXISTS email_compose_log_claim ON email_compose_log (claim_id, at);
CREATE TABLE IF NOT EXISTS email_compose_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  violations TEXT NOT NULL
);
