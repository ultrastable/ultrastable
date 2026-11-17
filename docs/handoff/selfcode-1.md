---
consumer: foundation/writeback.py
---
# SELFCODE-1: the self-improving code loop (2026-11-17)

> Ultrastable is the foundation for any autonomous system.

Session: session_0156nqDtPUh62FutsmGkcuTa

The executor wrote changes only for queue items and went idle when the queue was empty. `foundation/selfcode.py` now files work from measured signals, the ladder has free GitHub Models routes, and settle scores each merged change against its signal. Probe: `python3 -m foundation selfcode --check` and `tests/foundation/test_selfcode.py`. Next: dispatch `executor.yml` and settle the first agent-authored change.

Update 15:45Z: the first live run filed a Q-SELF item that the criticality gate held back; items now carry raises-deploys.

## 2026-11-17 capacity share (Session: session_0156nqDtPUh62FutsmGkcuTa)
- Defect: self-code items carry no ranker score, so `executor.pick` sorted them behind every scored queue item (175 ahead) and the agent never took one.
- Fix: `selfcode.prefer` (called from `executor.run`) gives Q-SELF-<kind>-* and Q-INTAKE-* items the run while their share of the last `share_window` executor rows is below `capacity_share` (doctrine/selfcode.json rails). `score` divides by file size (`tractable_bytes`) so the first changes are small files a free model can rewrite whole. TODO markers are read from comment tokens only.
- Probe: `python3 -m unittest tests.foundation.test_selfcode`; live: an executor row on loop-evidence whose issue starts `Q-SELF-`.

## 2026-11-17 first live pickup (Session: session_0156nqDtPUh62FutsmGkcuTa)
- The executor took Q-SELF-unused-import-foundation-preflight-py at 16:26 and 16:30 and failed "checks failed" both times with the glm model: the whole tests/foundation suite is red on the runner for a reason outside the change (the failing test names were cut from the log, only the tail of the output was kept).
- Fix: BASELINE-1 in `foundation/executor.py` (`failing_tests`, `preexisting_failures`): when the check fails, the failing tests are re-run on a clean worktree of HEAD and a failure that predates the change does not count; the failing test ids lead the recorded reason. `git clean` on a failed attempt now keeps `docs/issues/Q-SELF-*`, `docs/issues/Q-INTAKE-*` and `ops/selfcode` (it was deleting the item and the ledger, which is why no ledger reached loop-evidence).
- Probe: `python3 -m unittest tests.foundation.test_executor`.
## 2026-11-17 order fix (Session: session_0156nqDtPUh62FutsmGkcuTa)
- Live rows after #499 still took Q-GROW-*: `growth.prefer` ran first and kept only growth items, so `selfcode.prefer` had nothing to reserve. It now runs before `growth.prefer` in `executor.run`.

## 2026-11-17 ladder resilience (Session: session_0156nqDtPUh62FutsmGkcuTa)
- After BASELINE-1 the self-code ledger reaches loop-evidence (filed rows at 16:43-16:45). The executor then failed Q-SELF-bare-except-foundation-clockwork-py on its first rung: GitHub Models answered HTTP 200 text/plain "OK", `agent_ladder.call` raised RuntimeError, and the executor did not catch it, so the item aborted without escalating to the next rung.
- Fix: `executor.ladder_call` turns a rung's transport failure into a failed attempt, so the next attempt uses the next rung. Probe: `python3 -m unittest tests.foundation.test_executor`.
