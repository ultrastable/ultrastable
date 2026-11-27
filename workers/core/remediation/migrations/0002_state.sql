-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Remediation module state (US-SPEC-17 R09, R16, R17, R18): the kernel register is core/kernel (tables kernel_*), and a store that
-- only has the kernel migrations still works, because core/kernel/failure.js guards every read of these tables. Idempotent.

-- A closed remediation whose detector fired again was reopened: one row per failure mode, counting the relapses (R16).
CREATE TABLE IF NOT EXISTS remediation_relapses (
  fm_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL
);

-- Consecutive passing readings of a remediation's closing probe, for a closure that needs more than one pass (R17).
CREATE TABLE IF NOT EXISTS remediation_passes (
  item_id TEXT PRIMARY KEY,
  streak INTEGER NOT NULL DEFAULT 0
);

-- The detector reading that opened a remediation, and when verification judged whether the firing was real (R09).
CREATE TABLE IF NOT EXISTS remediation_firings (
  item_id TEXT PRIMARY KEY,
  hit_id INTEGER NOT NULL,
  verified_at TEXT
);

-- The hash of the source an open breaker was opened against; a different hash re-arms it (R18).
CREATE TABLE IF NOT EXISTS remediation_breaker_sources (
  target TEXT NOT NULL,
  signature TEXT NOT NULL,
  source_hash TEXT,
  PRIMARY KEY (target, signature)
);

-- Every change of a breaker, so a re-arm or a closure carries its reason.
CREATE TABLE IF NOT EXISTS remediation_breaker_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  signature TEXT NOT NULL,
  at TEXT NOT NULL,
  event TEXT NOT NULL,                       -- opened | half-open-failed | rearmed | closed
  detail TEXT
);
