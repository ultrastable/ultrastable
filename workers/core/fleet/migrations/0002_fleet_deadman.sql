-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Dead-man checkpoint (US-11-R08): the end of the last pass, so slots that elapsed while the check was not running are judged on the next. Idempotent.
CREATE TABLE IF NOT EXISTS fleet_deadman_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_to TEXT NOT NULL
);
