-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Independent audits of report cards (US-SPEC-13 R23): a second computation of each dimension by a differently written path, the
-- phantom-touch check, and an attestor's verdicts when an attestor is configured. attestor is NULL for an audit with no outside party.
CREATE TABLE IF NOT EXISTS sla_card_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,                  -- l3_cards.id
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  disagree INTEGER NOT NULL,                 -- dimensions whose second path differs from the stored score
  phantom INTEGER NOT NULL DEFAULT 0,        -- items closed by a person role with no matching console action
  attestor TEXT,                             -- who attested, or NULL
  agree INTEGER,                             -- 1 when the attestor agreed with every dimension, 0 otherwise, NULL without an attestor
  detail TEXT NOT NULL                       -- JSON: per-dimension second path and verdicts
);
CREATE INDEX IF NOT EXISTS sla_card_audits_card ON sla_card_audits (card_id, id);
