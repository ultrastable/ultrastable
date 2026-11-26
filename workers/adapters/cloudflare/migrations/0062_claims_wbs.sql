-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Claims module (US-SPEC-08 R26): the optional WBS code of a work item. Idempotent.

CREATE TABLE IF NOT EXISTS claims_wbs (
  item_id TEXT PRIMARY KEY,
  code TEXT NOT NULL              -- <portfolio>.<program>.<project>.<phase>[.<task>]
);
CREATE INDEX IF NOT EXISTS idx_claims_wbs_code ON claims_wbs(code);
