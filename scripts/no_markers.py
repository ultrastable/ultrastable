#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MARKER-ROOT-1 (Rowan, 2026-11-21: "This is an open loop ... find its root causes and remediate it system-wide").
Root cause of PRs that sat in conflict until a person or session stepped in: main carried committed merge-conflict markers (README.md,
platform/adapters/README.md), so every PR conflicted there on every merge and the server-side resolver could not match the nested hunks.

  python3 scripts/no_markers.py          # exit 1 and list every tracked text file that carries conflict markers (step in `checks`)
  python3 scripts/no_markers.py --fix    # flatten hunks whose sides differ only in generated claim values; exit 1 if any marker remains

`--fix` runs in scripts/regen_generated.py after every merge to main, so a marker that reaches main by a direct push is removed by the next
pass with no person and no session; a hunk whose written text differs is left and reported (the check then fails the change that carries it)."""
import re, subprocess, sys

MARK = re.compile(r"^(<<<<<<< \S|>>>>>>> \S)")
CLAIM = re.compile(r"(<!-- claim:[\w.-]+ -->)(.*?)(<!-- /claim -->)", re.S)
SKIP = ("scripts/no_markers.py", "scripts/resolve_generated.py", "tests/")


def tracked():
    out = subprocess.run(["git", "grep", "-lIE", r"^(<<<<<<< |>>>>>>> )\S"], capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f and not f.startswith(SKIP)]


def flatten(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out, inside, block = [], 0, []
    for l in lines:
        if l.startswith("<<<<<<< "):
            inside += 1
            continue
        if l.startswith(">>>>>>> "):
            inside -= 1
            if inside == 0:
                if len({CLAIM.sub(r"\1\3", b) for b in block}) != 1:
                    return False
                out.append(block[-1])
                block = []
            continue
        if inside and (l == "=======" or l.startswith("||||||| ")):
            continue
        (block if inside else out).append(l)
    if inside or block:
        return False
    open(path, "w", encoding="utf-8").write("\n".join(out))
    return True


def main(argv):
    bad = tracked()
    if "--fix" in argv:
        for f in list(bad):
            if flatten(f):
                print("flattened", f)
                bad.remove(f)
    for f in bad:
        print("conflict markers:", f)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
