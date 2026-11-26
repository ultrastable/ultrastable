-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Claims module (US-SPEC-08 R19): the pull request a work claim is linked to, so a merged or closed pull request releases it. Idempotent.

CREATE TABLE IF NOT EXISTS claims_pr (
  claim_id INTEGER PRIMARY KEY,   -- claims_lock.id
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_pr_ref ON claims_pr(repo, pr);
