-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- The person's time zone (US-SPEC-16 R16: the quiet period is the person's local night). Additive and idempotent.
CREATE TABLE IF NOT EXISTS walkthrough_settings (
  person TEXT PRIMARY KEY,
  timezone TEXT,
  updated_at TEXT
);
