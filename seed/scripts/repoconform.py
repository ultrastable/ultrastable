#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-CONFORM-1: check that a repository carries the machine-readable files in autonomy/repo-conformance.json.

python3 scripts/repoconform.py --check [PATH]   exit 1 and list each missing or empty file
python3 scripts/repoconform.py --json [PATH]    the same reading as JSON, for loops
"""
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
RULES = KIT / "autonomy" / "repo-conformance.json"


def read(root):
    root = Path(root)
    rows = []
    for f in json.loads(RULES.read_text())["files"]:
        p = root / f["path"]
        if not p.is_file():
            rows.append({**f, "ok": False, "why": "missing"})
            continue
        text = p.read_text(errors="replace")
        ok = f["contains"] in text or f["contains"] in text.replace('"', "")  # a generator may quote YAML scalars (apiVersion: "backstage.io/v1alpha1")
        rows.append({**f, "ok": ok, "why": "" if ok else "does not contain %r" % f["contains"]})
    return rows


def main(argv):
    mode = argv[1] if len(argv) > 1 else "--check"
    root = argv[2] if len(argv) > 2 else KIT
    rows = read(root)
    bad = [r for r in rows if not r["ok"]]
    if mode == "--json":
        print(json.dumps({"ok": not bad, "files": rows}, indent=2))
    else:
        for r in bad:
            print("repoconform: %s %s (%s, %s)" % (r["path"], r["why"], r["standard"], r["source"]))
        print("repoconform: %d/%d files conform" % (len(rows) - len(bad), len(rows)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
