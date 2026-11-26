-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- Model ladder additions (US-SPEC-09 sections 4 and 5): the exemption registry of the floor guard and the standards gate, the
-- L1 cache and its events, the L5 exemplar bank, the L7 queue of tasks offered again in the next window, and the tool-call
-- validity view. Idempotent and additive: no existing table or view is touched.

-- A banned or under-limit model may be used only through a row here: model, role, evidence, expiry.
CREATE TABLE IF NOT EXISTS ladder_exemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- floor | standards
  model TEXT NOT NULL,                      -- a model id, or a regular expression over model ids
  role TEXT NOT NULL,                       -- the role the exemption covers; 'reader-facing' is never exempt
  field TEXT,                               -- standards: max_out | context (null for a floor exemption)
  evidence TEXT NOT NULL,                   -- what was observed that justifies it
  registered_at TEXT NOT NULL,
  expires_at TEXT                           -- null = no expiry
);
CREATE INDEX IF NOT EXISTS idx_ladder_exemptions ON ladder_exemptions(kind, model);

-- L1 cache: exact key (task class plus prompt hash), TTL, source hash for invalidation, optional embedding for the semantic lookup.
CREATE TABLE IF NOT EXISTS ladder_cache (
  task_class TEXT NOT NULL,
  key TEXT NOT NULL,
  source_hash TEXT,
  value TEXT NOT NULL,
  embedding TEXT,                           -- JSON array of numbers (unit vector) or null
  prefix_hash TEXT,
  cost REAL NOT NULL DEFAULT 0,             -- what a miss cost, so a hit can record what it saved
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_class, key)
);
CREATE TABLE IF NOT EXISTS ladder_cache_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  task_class TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- exact | semantic | miss | invalidated
  saved_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ladder_cache_events ON ladder_cache_events(task_class, id);

-- L5 exemplar bank: verified outputs only.
CREATE TABLE IF NOT EXISTS ladder_exemplars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_class TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  embedding TEXT,
  cost REAL NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  UNIQUE (task_class, input_hash)
);

-- L7: a task whose cap is breached with no free rung waits here for the next window.
CREATE TABLE IF NOT EXISTS ladder_queue (
  task_id TEXT PRIMARY KEY,
  task_class TEXT NOT NULL,
  payload TEXT,
  queued_at TEXT NOT NULL,
  not_before TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'     -- queued | offered
);

-- Tool-call validity per task class: share of attempts that did not fail on a tool-call parse, and the canary pass share.
DROP VIEW IF EXISTS ladder_v_tool_call_validity;
CREATE VIEW ladder_v_tool_call_validity AS
SELECT a.task_class AS task_class,
       COUNT(*) AS attempts,
       SUM(CASE WHEN a.signal = 'tool_call_parse' THEN 1 ELSE 0 END) AS parse_failures,
       1.0 - 1.0 * SUM(CASE WHEN a.signal = 'tool_call_parse' THEN 1 ELSE 0 END) / COUNT(*) AS tool_call_validity_rate,
       (SELECT 1.0 * SUM(passed) / COUNT(*) FROM ladder_canary_runs c WHERE c.task_class = a.task_class) AS canary_pass_share
FROM ladder_attempts a
GROUP BY a.task_class;
