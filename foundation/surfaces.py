# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-MANIFEST-1: the platform's wrapper around the reconciler every system carries (seed/scripts/surfaces.py), so one improvement reaches
every system. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation surfaces --check|--render|--validate|--plan [github|wellknown|publiccode|all] [--root DIR]

--root defaults to the seed/ kernel (the template's own manifest); pass a clone of any repository of the org to reconcile that one."""
import importlib.util, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def engine():
    spec = importlib.util.spec_from_file_location("seed_surfaces", REPO / "seed/scripts/surfaces.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main(argv=None) -> int:
    av = list(sys.argv[1:] if argv is None else argv)
    if "--root" not in av:
        av += ["--root", str(REPO / "seed")]
    return engine().main(av)
