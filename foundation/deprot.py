# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DEPROT-1: dependency rot is watched by a bot, and the watch must cover every manifest. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation deprot --check   every package.json and pyproject.toml directory, and the workflows, has a Dependabot entry for its ecosystem

Dependabot opens the update pull requests on its own schedule; the lane merges a green one (no person). This check is the detector: a manifest added
without an entry is a failure (failure mode fm-dependency-rot, detector `dependency-watch`, yearfail month `dependency-rot`). The logic is the one copy
every system carries, seed/scripts/deprot.py (USER-BACKEND-1); this module is the platform's command for it.
Consumers: doctrine/detectors.json, foundation/yearfail.py, tests/foundation/test_deprot.py."""
from __future__ import annotations
import importlib.util, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("seed_deprot", REPO / "seed/scripts/deprot.py")
_kit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_kit)
ECO, SKIP, manifests, covered, baseline, missing = _kit.ECO, _kit.SKIP, _kit.manifests, _kit.covered, _kit.baseline, _kit.missing


def check(root=REPO) -> list[str]:
    return _kit.check(root)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    bad = check()
    if "--strict" in argv:  # the closing probe of Q-DEPROT-dependabot: every manifest is covered, the baseline is empty
        bad += [f"baseline still lists {e} at {d}" for e, d in sorted(baseline(REPO))]
    print("\n".join(bad) or "deprot ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
