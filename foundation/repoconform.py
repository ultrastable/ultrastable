# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-CONFORM-2: the platform's command for the conformance reader every system carries (seed/scripts/repoconform.py), so the queue, the
register and the failure audit run the one implementation by name (USER-BACKEND-1). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation repoconform --check [PATH] [--only FILE]   PATH defaults to the seed/ kernel; `.` reads the platform repository
  python3 -m foundation repoconform --remote OWNER/REPO            a repository's default branch through GitHub; unreadable is unmeasured
  python3 -m foundation repoconform --fleet doctrine/fleet-map.json

Consumers: foundation/standards.py (probe kind conform:), docs/issues/Q-CONFORM-*.json (closing probes). Tests: seed/tests/test_repoconform.py."""
import importlib.util, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def engine():
    spec = importlib.util.spec_from_file_location("seed_repoconform", REPO / "seed/scripts/repoconform.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main(argv=None) -> int:
    return engine().main(["repoconform", *(sys.argv[1:] if argv is None else argv)])


if __name__ == "__main__":
    sys.exit(main())
