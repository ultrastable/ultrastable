-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Read-only channel probes (US-21-R25). One row per probe run; detail is redacted before it is written. Idempotent.
CREATE TABLE IF NOT EXISTS packs_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  ok INTEGER NOT NULL,                  -- 1 the read-only check passed, 0 it failed
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_packs_probes ON packs_probes(pack_id, channel, id);
