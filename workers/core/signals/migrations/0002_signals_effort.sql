-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Fitness experiment inputs (US-SPEC-12 R21): what triage expected of a signal, what it cost, and what its artifacts later closed. Idempotent.
CREATE TABLE IF NOT EXISTS signals_effort (
  signal_id TEXT PRIMARY KEY,
  expected_reduction REAL NOT NULL,          -- from the fitness port when the signal was triaged
  effort REAL NOT NULL,
  realized_reduction REAL,                   -- open questions closed by accepted strict-shrink revisions of artifacts built from the signal; null until one is revised
  recorded_at TEXT NOT NULL
);
