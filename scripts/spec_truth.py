#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-TRUTH-1: "BUILT must name a file that exists" (specs/README.md, US-00-R03, US-20-R06) as a check of this repository.

  python3 scripts/spec_truth.py [--check | --list | --prune]

The engine is workers/tools/spec_truth.py (one copy: it was written when the specifications lived in their own repository and nothing ran it
after they were folded into specs/ here). This script runs it over specs/ with the trees the specifications name paths in (CODE_DIRS: workers/,
the repository root, seed/). A finding is a BUILT status line that names no path, names only paths that do not exist, or names some that do not.
--check fails on any finding that is not in doctrine/spec-truth-baseline.json. The baseline only shrinks: --prune drops entries that no longer
fail and never adds one, and --check fails when the baseline holds more rows than its recorded ceiling or a row that no longer fails.
A finding is keyed by its file, its problem and the missing paths, so moving a line does not change its key.
--list prints every finding, baselined or not.
Consumers: tests/foundation/test_spec_truth.py (foundation tests step of checks), doctrine/claims.json.
"""
import importlib.util, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = "doctrine/spec-truth-baseline.json"
CODE_DIRS = ("workers", ".", "seed")

_spec = importlib.util.spec_from_file_location("workers_spec_truth", REPO / "workers/tools/spec_truth.py")
engine = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(engine)


def key(f):
    return f"{f['spec']}: {f['problem']}" + (": " + ", ".join(sorted(f["missing"])) if f.get("missing") else ": " + f["text"][:80])


def findings(root=REPO):
    root = Path(root)
    return engine.findings(root / "specs", [root / d for d in CODE_DIRS])


def check(root=REPO, baseline=None):
    root = Path(root)
    if baseline is None:
        p = root / BASELINE
        baseline = json.loads(p.read_text("utf-8")) if p.is_file() else {"ceiling": 0, "rows": []}
    known, now = set(baseline["rows"]), {key(f) for f in findings(root)}
    bad = [f"{k}; fix the row or the code (the baseline only shrinks)" for k in sorted(now - known)]
    bad += [f"{k}: in the baseline but no longer failing; run python3 scripts/spec_truth.py --prune" for k in sorted(known - now)]
    if len(baseline["rows"]) > baseline["ceiling"]:
        bad.append(f"baseline holds {len(baseline['rows'])} rows, above its ceiling {baseline['ceiling']}; the baseline only shrinks")
    return bad


def main(argv):
    p = REPO / BASELINE
    if "--list" in argv:
        print("\n".join(f"{key(f)} (line {f['line']})" for f in findings()) or "no false BUILT line")
        return 0
    if "--prune" in argv:
        cur = json.loads(p.read_text("utf-8"))
        now = {key(f) for f in findings()}
        cur["rows"] = [r for r in cur["rows"] if r in now]
        cur["ceiling"] = min(cur["ceiling"], len(cur["rows"]))
        p.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")
    bad = check()
    base = len(json.loads(p.read_text("utf-8"))["rows"]) if p.is_file() else 0
    print("\n".join(bad) or f"spec truth ok: no false BUILT line outside the baseline ({base} baselined)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
