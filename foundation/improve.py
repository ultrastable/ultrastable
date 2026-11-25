# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""IMPROVE-1 and FRONTEND-AUTO-1 on the platform. The engine lives once in seed/scripts/improve.py so every system carries the same
loop; this module runs it against this repository with doctrine/improve.json.

  python3 -m foundation improve --report | --run [--apply] | --check | --probe KIND:KEY
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "seed/scripts/improve.py"
_spec = importlib.util.spec_from_file_location("seed_improve", _SRC)
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
_m.REPO = Path(__file__).resolve().parents[1]

REPO, CFG, LEDGER, STATUS = _m.REPO, "doctrine/improve.json", _m.LEDGER, _m.STATUS
load, plan, apply, probe, check, signals, tiers, settle, metric_now = (_m.load, _m.plan, _m.apply, _m.probe, _m.check, _m.signals,
                                                                     _m.tiers, _m.settle, _m.metric_now)


def main(argv=None) -> int:
    return _m.main(argv)
