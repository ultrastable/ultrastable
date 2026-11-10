-- BP26-LEASES-KILLSWITCH-1 (2026-10-28, charter pillar autonomy; agent_issues 1000361, GitHub 4457; program QNFO.OPS, project BP26.AGENTOPS, session bp26-reliability).
-- WHAT: qnfo-deploy-guard 1.4.0 reads the global kill switch ops_config.fleet_kill_switch (off by default) and refuses new work claims, renewals, deploy leases and secret leases
-- with 503 reason kill-switch while it is on; every fresh work claim takes the next fence number for its path (work_claims.fence) and POST /work-lock/check validates token plus fence.
-- cf-ops-actions action kill-switch-drill (scripts/cf_ops_actions.py) exercises it live and appends kill_switch_tests rows, which is what metric kill_switch_test_age_days reads.
-- The other loops adopt the flag one by one (roadmap rows below); the drill reports the readers it covered and the ones still pending.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'fleet_kill_switch'; DELETE FROM roadmap_implementation WHERE item LIKE 'BP26-LEASES-KILLSWITCH-1%' OR item LIKE 'ROADMAP-1: QNFO.OPS BP26-KILLSWITCH-%'; DELETE FROM decision_log WHERE action LIKE 'BP26-LEASES-KILLSWITCH-1:%';

ALTER TABLE work_claims ADD COLUMN fence INTEGER;

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES ('fleet_kill_switch', 'off', 'BP26-LEASES-KILLSWITCH-1: global kill switch. on = no new claim, deploy, secret write or other side effect starts in a worker that reads it; off = normal. Flip it only through the kill-switch-drill action or an incident (docs/KILL-SWITCH-DRILL.md); revert is setting it to off.');

-- ULTRASTABLE-TENANT-1: tenant data (QNFO seed/ledger rows) removed from the product copy; seed your own in your tenant repo.
