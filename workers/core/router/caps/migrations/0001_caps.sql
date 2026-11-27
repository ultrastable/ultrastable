-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- core/router/caps (US-SPEC-09 sections 3): one switch row per loop and a drill record. Idempotent; additive.
CREATE TABLE IF NOT EXISTS caps_switches (
  name TEXT PRIMARY KEY,               -- '*' is the global switch; any other name is a loop
  is_on INTEGER NOT NULL DEFAULT 0,    -- 1 = engaged: the loop's actions stop, its measurement continues
  reason TEXT,
  set_by TEXT,
  set_at TEXT
);
CREATE TABLE IF NOT EXISTS caps_drills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  bound_ms INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  refused_ok INTEGER NOT NULL,         -- every probe was refused while the switch was on
  event_seen INTEGER NOT NULL,         -- every probe left its observation event
  resumed_ok INTEGER NOT NULL,         -- after the switch went off, work was granted again
  switch_off_after INTEGER NOT NULL,   -- the row reads off at the end, in every case
  passed INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS caps_drills_finished ON caps_drills (passed, id);
