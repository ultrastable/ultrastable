-- PR-LATENCY-1 (Rowan, 2026-11-21: "PR should not be sitting in GitHub for more than a second"): every sweeper pass records how long PRs take to
-- merge and how old the oldest open one is, so time-to-merge is a measured metric with a stall alarm, not an impression.
ALTER TABLE sweeper_runs ADD COLUMN merge_p50_min REAL;
ALTER TABLE sweeper_runs ADD COLUMN merge_p95_min REAL;
ALTER TABLE sweeper_runs ADD COLUMN oldest_open_pr_min REAL;
ALTER TABLE sweeper_runs ADD COLUMN stalled_prs INTEGER NOT NULL DEFAULT 0;
