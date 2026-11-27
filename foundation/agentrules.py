# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-ENTRY-1: a short entry file every agent can read, and the standing rules fetched by path. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation agentrules --for PATH [PATH ...] [--full] [--limit N]   the rules that govern these paths
  python3 -m foundation agentrules --show ID | --list | --budget
  python3 -m foundation agentrules --check     the platform's entry and the kernel's entry are inside their budget and name every document

The engine lives once in seed/scripts/agentrules.py (every seeded system carries it); this module imports it, so one improvement reaches every system.
Data: doctrine/agent-entry.json (platform), seed/autonomy/agent-entry.json (kernel). Tests: seed/tests/test_agentrules.py, tests/foundation/test_agentrules.py."""
from __future__ import annotations
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "seed" / "scripts"))
import agentrules as _engine  # noqa: E402

CONFIG = "doctrine/agent-entry.json"
parse, for_paths, find, closure, named, budget = _engine.parse, _engine.for_paths, _engine.find, _engine.closure, _engine.named, _engine.budget


def check(root=REPO) -> list[str]:
    """Both entries: the platform's own, and the kernel's as a new system will receive it."""
    root = Path(root)
    return _engine.check(root, _engine.load(root, CONFIG)) + ["seed/" + b for b in _engine.check(root / "seed")]


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "agent entry ok: " + ", ".join(f"{e} {v['bytes']} bytes" for e, v in budget(REPO, _engine.load(REPO, CONFIG))["entries"].items()))
        return 1 if bad else 0
    return _engine.main(a, root=REPO, config=CONFIG)


if __name__ == "__main__":
    sys.exit(main())
