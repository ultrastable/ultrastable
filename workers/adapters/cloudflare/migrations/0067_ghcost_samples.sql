-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- core/ghcost sanitized billing samples (US-24-R22). Idempotent; additive.
CREATE TABLE IF NOT EXISTS ghcost_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                  -- usage | budgets
  source TEXT NOT NULL,                -- live | fixture
  fields TEXT NOT NULL,                -- JSON: field name -> type, over every usage item
  items INTEGER NOT NULL,
  sample TEXT NOT NULL,                -- JSON: the first five items with organization and repository names hashed
  shape TEXT NOT NULL,                 -- pass | drift | unmeasured
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ghcost_samples_by_kind ON ghcost_samples (kind, id);
