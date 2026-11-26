-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Who did what through the person-facing pack surface (US-21-R18): one row per enable, disable, switch, approval or rejection.
-- Never holds a recipient or message content. Idempotent.
CREATE TABLE IF NOT EXISTS packs_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,                 -- enable | disable | switch | approve | reject
  target TEXT NOT NULL,                 -- a pack id, a switch scope or a queue id
  result TEXT NOT NULL,                 -- ok, or the refusal reason
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_packs_actions ON packs_actions(id);
