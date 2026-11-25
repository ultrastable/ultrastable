# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-SPEC-1: the platform's entry to seed/scripts/system.py, which renders and probes seed/SYSTEM.md (identity, tick, boot stages,
ignition ladder, criticality numbers and each standing rule's in-kit enforcement). `--rule ID` is the allow-listed closing probe of Q-KIT-<ID>."""
from __future__ import annotations
import importlib.util
from pathlib import Path

_p = Path(__file__).resolve().parents[1] / "seed/scripts/system.py"
_s = importlib.util.spec_from_file_location("seed_system", _p)
_m = importlib.util.module_from_spec(_s); _s.loader.exec_module(_m)
check, rules, render = _m.check, _m.rules, _m.render


def main(argv=None) -> int:
    return _m.main(argv)
