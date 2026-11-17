#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""REPOS-1 closing probe for Q-REPOS-RECONCILE-SEED-WORKERS: exit 0 only when no module name exists in both seed/worker/src and workers/core."""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
stem = lambda p: p.name.rsplit(".", 1)[0] if p.is_file() else p.name
a = {stem(p) for p in (root / "seed/worker/src").iterdir() if not p.name.startswith(".")}
b = {stem(p) for p in (root / "workers/core").iterdir() if not p.name.startswith(".") and p.name != "README.md"}
both = sorted(a & b)
print(f"{len(both)} module name(s) in both trees: {', '.join(both) or 'none'}")
sys.exit(1 if both else 0)
