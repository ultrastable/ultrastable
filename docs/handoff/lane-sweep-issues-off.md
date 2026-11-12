---
consumer: foundation/writeback.py
---
# Lane sweep failed on every run because Issues are off (2026-11-12)

> Ultrastable is the foundation for any autonomous system.

Session: session_0156nqDuUz7hvNg4YU9MVeAS

Found by the liveness probe on its first run in Actions (13:47 UTC): 6 of 7 loops alive, `merge-lane` failing. `lane.yml` run 324 (the scheduled sweep) ended with "the repository has disabled issues" on `gh issue list` in `scripts/completion_sweep.sh`, two failed calls, exit 1. Issues were switched off when work items became `docs/issues` data, and the sweep still listed them.

Fix: the sweep asks the repository once whether Issues are on and skips the issue steps when they are off; `session-evidence` joins the kept branches. Probe: `tests/foundation/test_lane_merger.py`, `test_completion_sweep_is_green_when_issues_are_off_on_the_repository` (exit 0, no `gh issue` call, `done_issues=off`).

State of main read at the same time, not changed here: `python3 -m foundation pins --check` reports item `PORT-EXEC-1` on the roadmap with no runnable probe.
