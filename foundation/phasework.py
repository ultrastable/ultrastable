# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PHASED-WORK-1: every large change moves through audit, coverage, implement, verify, fix, integrate and final gate. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation phasework new --goal G --slices A,B,C [--gaps g1,g2] [--out run.json]
  python3 -m foundation phasework next run.json | done run.json AGENT --by WHO [--ok | --finding T] | status run.json
  python3 -m foundation phasework --check          the phase data, the Worker's orchestrator and the rule agree

The engine lives once in seed/scripts/phasework.py (every seeded system carries it); this module imports it, so one improvement reaches every system.
Data: seed/autonomy/phases.json. Tests: seed/tests/test_phasework.py, tests/foundation/test_phasework.py."""
from __future__ import annotations
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "seed" / "scripts"))
import phasework as _engine  # noqa: E402

new_run, ready, done, validate, check, status = _engine.new_run, _engine.ready, _engine.done, _engine.validate, _engine.check, _engine.status


def main(argv=None) -> int:
    return _engine.main(argv, root=REPO / "seed")


if __name__ == "__main__":
    sys.exit(main())
