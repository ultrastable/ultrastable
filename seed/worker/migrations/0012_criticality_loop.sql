-- CRITICALITY-LOOP-1: the criticality controller's own record, so the loop around k_eff closes on data the Worker holds.
-- criticality_history is one beat per tick (the loop's clock: doctrine/clocks.json reads `at`). criticality_actions is every change the
-- controller made to its lever, with the prediction attached to it and the grade the controller gave it later. Rows are never rewritten
-- except to record that grade; history older than control.history_keep_days is pruned by the step that writes it.
CREATE TABLE IF NOT EXISTS criticality_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  k_eff REAL NOT NULL,
  regime TEXT NOT NULL,                   -- subcritical | critical | supercritical
  mode TEXT NOT NULL,                     -- the dispatch lever after this tick: open | raise-only
  credited_deploys INTEGER NOT NULL DEFAULT 0,
  spend_units REAL NOT NULL DEFAULT 0,
  open_ignition_gaps INTEGER NOT NULL DEFAULT 0,
  stalled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS criticality_history_at ON criticality_history (at);

CREATE TABLE IF NOT EXISTS criticality_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  lever TEXT NOT NULL,                    -- dispatch_mode
  from_value TEXT NOT NULL,
  to_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  k_at_action REAL NOT NULL,
  prediction TEXT,                        -- "<metric> <op> <number> within <N> h"; null for a release or a revert
  due_at TEXT,
  graded_at TEXT,
  result TEXT                             -- hit | miss | null while the prediction is open
);
CREATE INDEX IF NOT EXISTS criticality_actions_open ON criticality_actions (result, due_at);
