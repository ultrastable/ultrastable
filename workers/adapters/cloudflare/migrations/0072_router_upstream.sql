-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Resolved upstream (US-SPEC-09 section 4): the model that actually served a request, beside the one asked for, and the probe of a
-- cost change on the real path (US-24-R53). Idempotent; router_calls is not altered.
CREATE TABLE IF NOT EXISTS router_upstream (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,
  at TEXT NOT NULL,
  provider TEXT,
  requested TEXT NOT NULL,              -- the model id of the configuration
  resolved TEXT NOT NULL                -- the model id the provider reported
);
CREATE INDEX IF NOT EXISTS router_upstream_requested ON router_upstream (requested, id);
CREATE TABLE IF NOT EXISTS router_cost_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  change_name TEXT NOT NULL,
  requested TEXT NOT NULL,
  resolved TEXT,
  unit_cost REAL,
  status_quo_unit_cost REAL,
  kept INTEGER NOT NULL,
  reason TEXT
);
