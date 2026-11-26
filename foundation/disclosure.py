# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISCLOSE-1: no new specification text on the public branch.

`python3 -m foundation disclosure --check` fails when specs/ holds a US-SPEC file that is not in the
shrink-only baseline in doctrine/disclosure.json. Full specification text belongs in ultrastable/ops spec/.
"""
import argparse, glob, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(root=ROOT):
    cfg = json.loads((root / "doctrine" / "disclosure.json").read_text())
    have = {os.path.basename(p) for p in glob.glob(str(root / cfg["public_spec_dir"] / "US-SPEC-*.md"))}
    return sorted(have - set(cfg["baseline"]))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="disclosure")
    ap.add_argument("--check", action="store_true")
    ap.parse_args(argv)
    new = check()
    for f in new:
        print(f"DISCLOSE-1: specs/{f} is new specification text on a public branch; it belongs in ultrastable/ops spec/", file=sys.stderr)
    print("disclosure ok" if not new else f"disclosure: {len(new)} new spec file(s)")
    return 1 if new else 0


if __name__ == "__main__":
    sys.exit(main())
