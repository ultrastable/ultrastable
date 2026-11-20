#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""NO-SWALLOW-1: "Never swallow an error" as code. Rule and baseline: doctrine/no-swallow.json.

  python3 scripts/lint_swallow.py [--check | --rebaseline]

A bare `except:` fails anywhere in the Python globs. `2>/dev/null` is counted per file; a count above the file's baseline fails (a new file has
baseline 0). --rebaseline only ever lowers numbers and drops files that reached 0: the baseline shrinks, it does not grow.
Consumers: tests/foundation/test_noswallow.py (foundation tests step of checks), doctrine/claims.json (the probes of the rule's sentence).
"""
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/no-swallow.json"
BARE = re.compile(r"^\s*except\s*:", re.M)
NULL = re.compile(r"2>\s*/dev/null")


def _files(root, globs, exclude):
    seen = set()
    for g in globs:
        for p in sorted(root.glob(g)):
            rel = str(p.relative_to(root))
            if p.is_file() and rel not in seen and rel not in exclude and "node_modules" not in p.parts:
                seen.add(rel)
                yield rel, p.read_text("utf-8", errors="replace")


def scan(root=REPO, cfg=None):
    """-> (bare_excepts [(file, line)], null_counts {file: n})"""
    root = Path(root)
    cfg = cfg or json.loads((root / CFG).read_text("utf-8"))
    bare = [(rel, t.count("\n", 0, m.start()) + 1) for rel, t in _files(root, cfg["python_globs"], cfg["exclude"]) for m in BARE.finditer(t)]
    nulls = {rel: len(NULL.findall(t)) for rel, t in _files(root, cfg["shell_globs"], cfg["exclude"])}
    return bare, {k: v for k, v in nulls.items() if v}


def check(root=REPO, cfg=None):
    root = Path(root)
    cfg = cfg or json.loads((root / CFG).read_text("utf-8"))
    bare, nulls = scan(root, cfg)
    bad = [f"{f}:{n}: bare except swallows every error; name the exception and log it" for f, n in bare]
    base = cfg.get("baseline", {})
    bad += [f"{f}: {n} uses of 2>/dev/null, baseline {base.get(f, 0)}; keep stderr or log the failure" for f, n in sorted(nulls.items()) if n > base.get(f, 0)]
    return bad


def main(argv):
    if "--rebaseline" in argv:
        cfg = json.loads((REPO / CFG).read_text("utf-8"))
        _, nulls = scan(REPO, cfg)
        old = cfg.get("baseline")
        cfg["baseline"] = dict(sorted(nulls.items())) if not old else {f: min(n, old[f]) for f, n in sorted(nulls.items()) if f in old}
        (REPO / CFG).write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    bad = check()
    print("\n".join(bad) or "no-swallow ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
