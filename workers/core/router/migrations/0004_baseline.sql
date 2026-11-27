-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Calibration baselines, summaries and verified adjustments (US-SPEC-09 section 5, infrastructure calibration). Idempotent; additive.
CREATE TABLE IF NOT EXISTS router_baseline (
  provider TEXT NOT NULL, rung TEXT NOT NULL, probe TEXT NOT NULL,
  mean_ms REAL NOT NULL, dev_ms REAL NOT NULL, n INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, rung, probe)
);
-- What a stress run measured, and what a monthly cleanup kept before it deleted the probe rows it summarizes.
CREATE TABLE IF NOT EXISTS router_calibration_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                  -- stress | monthly
  provider TEXT NOT NULL, rung TEXT, probe TEXT,
  n INTEGER NOT NULL, ok_n INTEGER NOT NULL, mean_ms REAL, p50_ms REAL, p95_ms REAL,
  from_at TEXT, to_at TEXT, at TEXT NOT NULL
);
-- A binding-only adjustment from an allowlist: applied, then kept or reverted on the next run by the metric it was meant to improve.
CREATE TABLE IF NOT EXISTS router_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL, old TEXT, new TEXT NOT NULL,
  metric_before REAL, metric_after REAL,
  applied_at TEXT NOT NULL, verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'applied'  -- applied | kept | reverted
);
CREATE INDEX IF NOT EXISTS router_adjustments_key ON router_adjustments (key, id);
