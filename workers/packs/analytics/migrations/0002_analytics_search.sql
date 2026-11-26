-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Analytics pack, search presence (US-SPEC-21 s7 analytics). Idempotent. One row per page and day, aggregate counts only: no search
-- query text, no query string and nothing about a person is stored.
CREATE TABLE IF NOT EXISTS analytics_search (
  day TEXT NOT NULL,
  page TEXT NOT NULL,                            -- path only, no query string or fragment
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position REAL,
  PRIMARY KEY (day, page)
);
