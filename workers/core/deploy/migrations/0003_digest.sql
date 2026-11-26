-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- US-07-R13: the comparison of the published artifact with the artifact the platform serves. One row per deploy that had a
-- digest to compare: match, mismatch, or skipped (the deployer cannot read a live digest). Additive and idempotent.
-- A mismatch also writes a failed `artifact:digest` row in deploy_probe_results, so the keep-or-revert rule applies to it.
CREATE TABLE IF NOT EXISTS deploy_digest_checks (
  ledger_id INTEGER PRIMARY KEY REFERENCES deploy_ledger(id),
  state TEXT NOT NULL,                     -- match | mismatch | skipped
  expected TEXT,                           -- the digest (or JSON map of file digests) the artifact carried
  live TEXT,                               -- what the platform reported, as JSON; null when it could not be read
  detail TEXT,
  at TEXT NOT NULL
);
