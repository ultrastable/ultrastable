-- OBJECTIVES-1: every system states what its agents work toward (objectives) and how that is measured (metrics with probes).
-- Same pattern as a fleet metric registry with trigger state: a metric that is outside its healthy condition files its own
-- remedy item, and recovers it when the probe passes. The tick step `measure` reads these tables; nobody has to look at them.
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,                    -- OBJ-1 ...
  tenant_id TEXT,                         -- null = this runtime's own tenant; a runtime only measures its own tenant
  statement TEXT NOT NULL,                -- the outcome, in the owner's words
  owner_role TEXT NOT NULL,               -- the manager who answers for it
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                         -- null = this runtime's own tenant; a runtime only measures its own tenant
  objective_id TEXT,                      -- null for liveness metrics that belong to the whole system
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- liveness (are the loops running) | target (the objective) | guard (must not worsen)
  source TEXT NOT NULL,                   -- builtin | sql | http | declared (named but not yet probed: itself a breach)
  spec TEXT NOT NULL,                     -- builtin name, one SELECT returning a number, a URL, or the declared text
  op TEXT NOT NULL,                       -- healthy when value <op> threshold: >= <= > < =
  threshold REAL NOT NULL,
  grace_hours REAL NOT NULL DEFAULT 0,    -- no breach until the system is this old (a new clock needs time to prove itself)
  owner_role TEXT NOT NULL,               -- who gets the remedy item
  remedy TEXT NOT NULL,                   -- what the remedy item tells that role to do
  last_value REAL,
  last_at TEXT,
  breached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
