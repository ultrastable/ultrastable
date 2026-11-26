-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- In-flight sends (US-21-R14, R19). The guard reserves a send before it calls the provider, in one conditional INSERT that checks the
-- idempotency key and both caps against sent rows and other reservations, so overlapping calls cannot all pass the same check. The row is
-- removed when the delivery ends, sent or refused. Only a hash-free key and a channel are kept: no recipient, no content. Idempotent.
CREATE TABLE IF NOT EXISTS guard_inflight (
  pack TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (pack, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_guard_inflight_caps ON guard_inflight(pack, channel, at);
