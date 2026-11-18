---
consumer: doctrine/registers.json
---
# GREEN-GUARD-1 handoff (Session: session_0156nqDts967bbXQmkB7DpSY)

What changed: server-side merges require a green full `checks` run (`seed/worker/src/greenguard.js`, `scripts/lane.sh`); lane rebase wedge (LANE-REBASE-1); regen push race (REGEN-PUSH-1); executor skips other repos' Q-CIFAIL items (FOREIGN-FIX-1). Probes: failure modes `fm-merge-without-checks`, `fm-lane-rebase-wedge`, `fm-regen-push-race`, `fm-foreign-ci-item` in `doctrine/registers.json`.
Open: #597 (PACE-1) and #598 (audit converge) carry their own red checks; #598 fails with "Q-AUDIT-CONVERGE-1: closed without evidence". Archived-repo workflows disabled by API (spec, workers, license); `.github` and `ops` were not reachable from this session.

Session: session_0156nqDts967bbXQmkB7DpSY — ciwatch now also watches ultrastable/.github (unreadable = unmeasured finding).

Session: session_0156nqDts967bbXQmkB7DpSY — MERGE-AUDIT-1 added after #619.
