# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-GATE-1 on the platform. The engine lives once in seed/scripts/specgate.py, so every seeded system carries the same gate.
Ultrastable is the foundation for any autonomous system."""
from __future__ import annotations
import importlib.util, sys
from pathlib import Path

_p = Path(__file__).resolve().parents[1] / "seed/scripts/specgate.py"
_s = importlib.util.spec_from_file_location("seed_specgate", _p)
_m = importlib.util.module_from_spec(_s); _s.loader.exec_module(_m)
REPO = Path(__file__).resolve().parents[1]
PARTS, missing = _m.PARTS, _m.missing
report = lambda root=REPO: _m.report(root)
quality = lambda root=REPO: _m.quality(root)
check = lambda root=REPO: _m.check(root)


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "specgate ok: every new open item has a done check, a prediction, an out-of-scope line and a live proof"); return 1 if e else 0
    import json; print(json.dumps(report(), indent=1)); return 0
