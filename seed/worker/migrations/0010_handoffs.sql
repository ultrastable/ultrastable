-- HANDOFF-1: work a code agent handed to the server. The agent's job ends at an open PR; the tick Worker owns every state after `open`.
-- States: open -> merged -> deployed -> verified (item closed) | conflict | deploy_failed (retried) -> blocked (3 failures, item blocked) | verify_failed -> rolled_back (item reopened) | closed_unmerged
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,            -- "<owner>/<repo>#<pr>"
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  title TEXT,
  item TEXT,                      -- backlog item the PR closes (items.id), optional
  agent TEXT,                     -- which code agent produced it (claude-code, codex, kimi, copilot, worker-ai, person, ...)
  verify TEXT,                    -- live probe run after deploy, e.g. "GET https://ultrastable.io/api/v1/status expect \"settled\""
  deploy TEXT,                    -- comma-separated worker ids from doctrine/topology.json, or empty for no deploy
  state TEXT NOT NULL DEFAULT 'open',
  detail TEXT,
  head_sha TEXT,
  merge_sha TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS handoffs_state ON handoffs (state, updated_at);
CREATE TABLE IF NOT EXISTS handoff_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  state TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS handoff_events_h ON handoff_events (handoff_id, id);
