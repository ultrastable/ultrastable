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

## 2026-11-17 order fix (Session: session_0156nqDtPUh62FutsmGkcuTa)
- Live rows after #499 still took Q-GROW-*: `growth.prefer` ran first and kept only growth items, so `selfcode.prefer` had nothing to reserve. It now runs before `growth.prefer` in `executor.run`.
