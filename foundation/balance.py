# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-BALANCE-1 (Rowan, 2026-11-21): every issue is resolved within its SLA, and the daily and weekly inflow of new issues never exceeds the
issues closed. Ultrastable is the foundation for any autonomous system, and this is the work queue's own ultrastable second loop.

First loop: the queue pass closes items by probe, the executor fixes them, dispose gives stale items a recorded disposition.
Second loop (this module), on every fleet pass (foundation/queue.py run), server-side:

  measure   inflow = items filed in the window (git add date), outflow = items closed with evidence in the window (git date of the status
            change), per day and per week; SLA = days allowed by priority label (doctrine/balance.json sla_days) against each open item's age.
  tipped    inflow > outflow in either window, or any open item past its SLA.
  correct   when tipped: (1) an open item whose normalised title equals an older open item's is superseded by it, with evidence;
            (2) a family (id prefix) that filed more than batch_threshold open items inside batch_window_days becomes one BATCH item that lists
            every member and closes only when every member's own probe has passed; (3) filing is throttled: admit() returns False once the day's
            quota (weekly outflow / 7, at least daily_quota_floor) is spent, and filers that call it skip a new item; (4) closure capacity rises:
            ops/balance.json closure_boost (read by the executor) goes up.
  honesty   superseded items lower NET inflow and are never counted as closures; outflow counts only fixed, gate and shelved closures, each of
            which carries evidence. Nothing is closed to move the number.

  python3 -m foundation balance --run [--apply]   measure, correct (with --apply writes items, ops/balance.json, site/balance-data.js)
  python3 -m foundation balance --report [--publish] the measurement as JSON; --publish writes ops/balance.json and the page data only
  python3 -m foundation balance --probe           exit 0 when balanced and inside SLA (closing probe of Q-BALANCE-*)
  python3 -m foundation balance --gate [--apply]   the filing gate every workflow runs before it commits docs/issues
  python3 -m foundation balance --check           the rules are well formed (exit 1 otherwise)
Stdlib only and free of other foundation imports, so seed/scripts/balance.py is this file and every system inherits it.
"""
from __future__ import annotations
import importlib.util as _ilu
import sys
from pathlib import Path

_spec = _ilu.spec_from_file_location("balance_core", Path(__file__).resolve().parents[1] / "seed/scripts/balance.py")
_core = _ilu.module_from_spec(_spec)
sys.modules["balance_core"] = _core
_spec.loader.exec_module(_core)
globals().update({k: v for k, v in vars(_core).items() if not k.startswith("__")})

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
