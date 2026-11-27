-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Per-task options (US-11-R21): a name, a timeout, a bounded retry count and a version. Kept beside fleet_tasks so that table is untouched. Idempotent.
CREATE TABLE IF NOT EXISTS fleet_task_options (
  task_id TEXT PRIMARY KEY,
  name TEXT,
  timeout_ms INTEGER,                        -- the work is not cancelled when it passes; the run ends failed (class timeout)
  retries INTEGER,                           -- extra attempts for a failure that may clear (5xx, timeout, exception)
  version TEXT,
  updated_at TEXT NOT NULL
);
