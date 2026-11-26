-- ORCHESTRATE-1: a work item the single-shot executor could not close is planned into steps, worked in parallel across ticks, reviewed by a different
-- model, fixed and integrated as one PR. One row per run and one per step; the tick's executor step advances the newest unfinished run.
CREATE TABLE IF NOT EXISTS orch_runs (id TEXT PRIMARY KEY, item TEXT NOT NULL, tenant_id TEXT, title TEXT NOT NULL, body TEXT, phase TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, review TEXT, pr_url TEXT, detail TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orch_runs_phase ON orch_runs(phase, updated_at);
CREATE INDEX IF NOT EXISTS idx_orch_runs_item ON orch_runs(item);
CREATE TABLE IF NOT EXISTS orch_steps (run TEXT NOT NULL, n INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL, paths TEXT NOT NULL, needs TEXT NOT NULL DEFAULT '[]', after TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0, change TEXT, findings TEXT, adapter TEXT, error TEXT, PRIMARY KEY (run, n));
