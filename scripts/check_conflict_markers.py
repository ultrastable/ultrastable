#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""NO-MARKERS-1: no tracked file carries a merge-conflict marker. Ultrastable is the foundation for any autonomous system.

Observed 2026-11-21: merges that resolved one generated file and then ran `git add -A` committed `<<<<<<<` blocks in README.md,
agents/PROJECT-INSTRUCTIONS.md, platform/adapters/README.md, site/claims-data.js and ops/checks-session.jsonl, and main carried them
because no check looked. This step in checks fails on any line that starts with a conflict marker.
"""
import re, subprocess, sys

MARK = re.compile(r"^(<<<<<<< |>>>>>>> |\|\|\|\|\|\|\| )")
files = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
bad = []
for f in filter(None, files):
    try:
        with open(f, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                if MARK.match(line):
                    bad.append(f"{f}:{n}: merge-conflict marker")
    except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
        continue
print("\n".join(bad) if bad else "no conflict markers")
sys.exit(1 if bad else 0)
