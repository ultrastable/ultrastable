# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PINS-1 (Rowan, 2026-11-21): supply-chain hardening. A workflow step that `uses:` an action by a movable tag (v4, main) runs whatever that
tag points to tomorrow; pinning to a full commit SHA makes the build reproducible. Sources: SLSA v1.0 (slsa.dev, OpenSSF, 2023), build track;
GitHub, "Security hardening for GitHub Actions" (pin actions to a full-length commit SHA); OpenSSF Scorecard check Pinned-Dependencies.
The baseline in doctrine/supply-chain.json may only shrink: `python3 -m foundation.pins` fails when unpinned refs exceed it. See CREDITS.md."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USES = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)", re.M)
SHA = re.compile(r"@[0-9a-f]{40}$")


def unpinned(root=ROOT):
    out = []
    for f in sorted((root / ".github/workflows").glob("*.y*ml")):
        for ref in USES.findall(f.read_text()):
            if not ref.startswith("./") and not ref.startswith("docker://") and not SHA.search(ref):
                out.append(f"{f.name}: {ref}")
    return out


def main(argv=None):
    base = json.loads((ROOT / "doctrine/supply-chain.json").read_text())["unpinned_baseline"]
    u = unpinned(); print(json.dumps({"unpinned": len(u), "baseline": base}))
    if len(u) > base:
        print("new unpinned action refs; pin to a full commit SHA:\n" + "\n".join(u), file=sys.stderr); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
